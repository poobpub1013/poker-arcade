import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChoicePokerEngine } from '../game/choicePokerEngine.js';

function makeBots(startingChips) {
  return Array.from({ length: 2 }, (_, i) => ({
    id: `bot-${i}`,
    name: `บอท ${i}`,
    avatar: null,
    isBot: true,
    chips: startingChips,
  }));
}

describe('ChoicePokerEngine simulation (both bots, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects anything other than exactly 2 players', () => {
    expect(() => new ChoicePokerEngine({ players: makeBots(500).slice(0, 1) })).toThrow();
  });

  // Unlike Hold'em/PLO, Choice Poker has no forced blinds/antes — nothing
  // compels a stack to shrink hand over hand. A bot with plenty of chips
  // still plays cautiously, but choicePokerBot.js ramps willingness toward
  // "just shove" once a stack drops below ~25% of its starting size (a
  // push/fold adjustment — see the short-stack test below), so the walk
  // isn't unbounded. This runs a large fixed number of hands and checks
  // correctness/conservation throughout, treating an early gameover as a
  // bonus-verified case rather than a requirement.
  it('plays many heads-up hands correctly, conserving total chips throughout', async () => {
    const startingChips = 500;
    const players = makeBots(startingChips);
    const totalStart = 2 * startingChips;

    const engine = new ChoicePokerEngine({ players });

    let sawDraw = false;
    let sawBetting = false;
    let sawShowdownWithDirection = false;
    let handsObserved = 0;

    engine.on('update', ({ reason }) => {
      if (engine.phase === 'draw') sawDraw = true;
      if (engine.phase === 'betting') sawBetting = true;
      if (reason === 'showdown') {
        expect(['stronger', 'weaker']).toContain(engine.lastResult.direction);
        sawShowdownWithDirection = true;
      }
      if (reason === 'hand-over' || reason === 'game-over') {
        handsObserved += 1;
        const total = engine.seats.reduce((sum, s) => sum + s.chips, 0);
        expect(total).toBe(totalStart);
      }
    });

    engine.startNextHand();
    for (let i = 0; i < 20000 && handsObserved < 80 && engine.phase !== 'gameover'; i++) {
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(['betting', 'draw', 'choice', 'showdown', 'handover', 'gameover']).toContain(engine.phase);
    expect(sawDraw).toBe(true);
    expect(sawBetting).toBe(true);
    expect(sawShowdownWithDirection).toBe(true);
    // Not a fixed minimum: the short-stack push/fold adjustment in
    // choicePokerBot.js means a match can now legitimately end decisively in
    // a handful of hands once either stack drops under ~25% of starting —
    // exactly the intended fix for matches that used to drag on for dozens
    // of trivial hands. What must hold regardless of how many hands it took
    // is conservation (checked per-hand above and again below) and, if
    // gameover was reached, that the winner ended up with everything.
    expect(handsObserved).toBeGreaterThan(0);

    const totalEnd = engine.seats.reduce((sum, s) => sum + s.chips, 0);
    expect(totalEnd).toBe(totalStart);

    if (engine.phase === 'gameover') {
      expect(engine.gameWinnerId).toBeTruthy();
      const winner = engine.seatById(engine.gameWinnerId);
      expect(winner.chips).toBe(totalStart);
    }

    engine.destroy();
  }, 60000);

  it('deals 5 cards to each seat every hand, including a joker often enough across many hands', async () => {
    let jokerSeen = false;
    let handsChecked = 0;

    function attach(engine) {
      engine.on('update', ({ reason }) => {
        if (reason !== 'hand-start') return;
        handsChecked += 1;
        for (const seat of engine.seats) {
          expect(seat.hand).toHaveLength(5);
          if (seat.hand.some((c) => c[0] === 'O')) jokerSeen = true;
        }
      });
      return engine;
    }

    let engine = attach(new ChoicePokerEngine({ players: makeBots(1000) }));
    engine.startNextHand();
    // Run several hands (not necessarily to completion) to get enough
    // samples that a 1-in-53 joker should show up at least once. The
    // short-stack push/fold adjustment in choicePokerBot.js means an
    // individual match can now legitimately conclude in a handful of hands
    // — restart a fresh match on gameover instead of stopping early, so the
    // sample size (and this test's reliability) doesn't depend on how long
    // any one match happens to run.
    for (let i = 0; i < 8000 && handsChecked < 60; i++) {
      if (engine.phase === 'gameover') {
        engine.destroy();
        engine = attach(new ChoicePokerEngine({ players: makeBots(1000) }));
        engine.startNextHand();
      }
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(handsChecked).toBeGreaterThan(0);
    expect(jokerSeen).toBe(true);
    engine.destroy();
  }, 60000);

  it('rejects a raise that does not exceed the current bet', async () => {
    const players = makeBots(500);
    const engine = new ChoicePokerEngine({ players });
    engine.startNextHand();

    // Force both seats through the draw phase immediately (stand pat).
    engine.handleAction(players[0].id, 'draw', []);
    engine.handleAction(players[1].id, 'draw', []);
    expect(engine.phase).toBe('betting');

    const opener = engine.seats[engine.currentActorSeatIndex];
    engine.handleAction(opener.id, 'raise', 20);
    expect(engine.currentBet).toBe(20);

    const responder = engine.seats[engine.currentActorSeatIndex];
    expect(() => engine.handleAction(responder.id, 'raise', 20)).toThrow();
    expect(() => engine.handleAction(responder.id, 'raise', 5)).toThrow();

    engine.destroy();
  });

  it('lets the higher bettor choose the direction, and a Stand ends the war immediately', async () => {
    const players = makeBots(500);
    const engine = new ChoicePokerEngine({ players });
    engine.startNextHand();
    engine.handleAction(players[0].id, 'draw', []);
    engine.handleAction(players[1].id, 'draw', []);

    const opener = engine.seats[engine.currentActorSeatIndex];
    engine.handleAction(opener.id, 'raise', 50);
    const responder = engine.seats[engine.currentActorSeatIndex];
    engine.handleAction(responder.id, 'stand');

    expect(engine.phase).toBe('choice');
    expect(engine.seats[engine.currentActorSeatIndex].id).toBe(opener.id);

    engine.handleAction(opener.id, 'weaker');
    // _runShowdown() chains synchronously into _finishHand() (same pattern
    // as GameEngine), so phase has already moved past 'showdown' by the time
    // handleAction returns — lastResult is what persists for display.
    expect(engine.phase).toBe('handover');
    expect(engine.lastResult.direction).toBe('weaker');
    expect(engine.lastResult.potAmount).toBe(50);

    engine.destroy();
  });
});
