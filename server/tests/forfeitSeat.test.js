import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../game/engine.js';
import { getVariant } from '../game/variants/index.js';
import { DoubtPokerEngine } from '../game/doubtPokerEngine.js';
import { ChoicePokerEngine } from '../game/choicePokerEngine.js';

const holdem = getVariant('texas-holdem');

function makeHumans(count, startingChips) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    avatar: null,
    isBot: false,
    chips: startingChips,
  }));
}

describe('GameEngine.forfeitSeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves the current actor and advances turn normally', () => {
    const engine = new GameEngine({ variant: holdem, players: makeHumans(3, 500), smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();

    const currentId = engine.seats[engine.currentActorSeatIndex].id;
    engine.forfeitSeat(currentId);

    const seat = engine.seatById(currentId);
    expect(seat.eliminated).toBe(true);
    expect(seat.chips).toBe(0);
    expect(engine.phase).toBe('betting');
    expect(engine.currentActorSeatIndex).not.toBe(-1);
    expect(engine.seats[engine.currentActorSeatIndex].id).not.toBe(currentId);

    engine.destroy();
  });

  it('regression: forfeiting a seat that is NOT the current actor does not skip the real current actor\'s turn', () => {
    const engine = new GameEngine({ variant: holdem, players: makeHumans(3, 500), smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();

    const currentId = engine.seats[engine.currentActorSeatIndex].id;
    const otherSeat = engine.seats.find((s) => s.id !== currentId);
    engine.forfeitSeat(otherSeat.id);

    // _applyAction pivots off this.currentActorSeatIndex, not the seat given —
    // calling it on a non-current-actor must never move whose turn it is.
    expect(engine.seats[engine.currentActorSeatIndex].id).toBe(currentId);
    expect(engine.seatById(otherSeat.id).eliminated).toBe(true);
    expect(engine.seatById(otherSeat.id).folded).toBe(true);

    // The real current actor can still act normally afterward.
    const legal = engine.getLegalActions(currentId);
    expect(legal).toBeTruthy();
    engine.handleAction(currentId, legal.canCheck ? 'check' : 'call');
    expect(engine.seats[engine.currentActorSeatIndex].id).not.toBe(currentId);
    expect(engine.seats[engine.currentActorSeatIndex].id).not.toBe(otherSeat.id);

    engine.destroy();
  });

  it('reduces active seats to 1 -> immediate gameover once no other action is pending', () => {
    const engine = new GameEngine({ variant: holdem, players: makeHumans(2, 500), smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();

    // Heads-up preflop: dealer/SB acts first — call to see the flop, then
    // BB checks to close the street (folding preflop alone doesn't
    // immediately close the round — the engine still waits on whoever's
    // left in _playersToAct, which is pre-existing behavior, not something
    // forfeitSeat needs to special-case).
    let actorId = engine.seats[engine.currentActorSeatIndex].id;
    engine.handleAction(actorId, 'call');
    actorId = engine.seats[engine.currentActorSeatIndex].id;
    engine.handleAction(actorId, 'check');
    expect(engine.street).toBe('flop');

    // Postflop heads-up: BB acts first — check, leaving nobody else owed an
    // action this street except whoever's now current.
    actorId = engine.seats[engine.currentActorSeatIndex].id;
    engine.handleAction(actorId, 'check');

    const lastActorId = engine.seats[engine.currentActorSeatIndex].id;
    engine.forfeitSeat(lastActorId);

    // Nobody else was owed an action this street, so the fold cascade closes
    // the betting round and ends the hand uncontested within this same call.
    // Because eliminated was set BEFORE that cascade ran, _finishHand's
    // gameover check sees it synchronously too — no extra hand-over ->
    // nextHand timer delay needed.
    expect(engine.phase).toBe('gameover');
    expect(engine.winnerId).toBeTruthy();
    expect(engine.winnerId).not.toBe(lastActorId);

    engine.destroy();
  });

  it('forfeiting during the all-in "revealing" streets does not strip an in-flight pot win', async () => {
    const players = makeHumans(3, 500);
    const totalStart = 3 * 500;
    const engine = new GameEngine({ variant: holdem, players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();

    const folder = engine.seats[engine.currentActorSeatIndex].id;
    engine.handleAction(folder, 'fold');
    const allin1 = engine.seats[engine.currentActorSeatIndex].id;
    engine.handleAction(allin1, 'allin');
    const allin2 = engine.seats[engine.currentActorSeatIndex].id;
    // Equal starting stacks means allin2's max possible commitment exactly
    // matches currentBet, not exceeds it — 'allin' as a raise action would
    // be rejected ("must raise more than current bet"); 'call' is the
    // correct action and still goes fully all-in since it's capped at chips.
    engine.handleAction(allin2, 'call');

    expect(engine.phase).toBe('revealing');

    engine.forfeitSeat(allin1);
    expect(engine.seatById(allin1).eliminated).toBe(true);
    // Deliberately NOT folded outside the betting phase — an in-flight
    // showdown scopes contenders by dealtIn && !folded, so leaving this
    // false is exactly what lets them still win the hand they were in.
    expect(engine.seatById(allin1).folded).toBe(false);

    for (let i = 0; i < 20 && engine.phase === 'revealing'; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    expect(engine.lastResult.type).toBe('showdown');
    expect(engine.lastResult.pots[0].winners.length).toBeGreaterThan(0);

    const totalEnd = engine.seats.reduce((sum, s) => sum + s.chips, 0);
    expect(totalEnd).toBe(totalStart);

    if (engine.lastResult.pots[0].winners.includes(allin1)) {
      expect(engine.seatById(allin1).chips).toBeGreaterThan(0);
    }

    engine.destroy();
  }, 15000);

  it('is idempotent — calling twice on an already-eliminated seat is a no-op', () => {
    const engine = new GameEngine({ variant: holdem, players: makeHumans(3, 500), smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    const currentId = engine.seats[engine.currentActorSeatIndex].id;
    engine.forfeitSeat(currentId);
    expect(() => engine.forfeitSeat(currentId)).not.toThrow();
    engine.destroy();
  });
});

function checkOrCallThroughBetting(engine) {
  let guard = 0;
  while (engine.phase === 'betting' && guard++ < 20) {
    const actorId = engine.seats[engine.currentActorSeatIndex].id;
    const legal = engine.getLegalActions(actorId);
    engine.handleAction(actorId, legal.canCheck ? 'check' : 'call');
  }
}

describe('DoubtPokerEngine.forfeitSeat', () => {
  it('draw phase: stands pat and correctly triggers the betting-phase cascade once everyone is resolved', () => {
    const players = makeHumans(3, 500);
    const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();

    const [a, b, forfeited] = engine.seats.map((s) => s.id);
    engine.handleDraw(a, []);
    engine.handleDraw(b, []);
    expect(engine.phase).toBe('draw'); // still waiting on the third seat

    engine.forfeitSeat(forfeited);

    expect(engine.seatById(forfeited).eliminated).toBe(true);
    expect(engine.seatById(forfeited).folded).toBe(true);
    expect(engine.seatById(forfeited).hasDrawn).toBe(true);
    // All dealt-in seats (including the forfeited one) now show hasDrawn,
    // so the draw->betting cascade fires exactly like it would if the third
    // player had genuinely stood pat.
    expect(engine.phase).toBe('betting');

    engine.destroy();
  });

  it('betting phase: resolves the current actor and advances turn normally', () => {
    const players = makeHumans(3, 500);
    const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    for (const s of engine.seats) engine.handleDraw(s.id, []);
    expect(engine.phase).toBe('betting');

    const currentId = engine.seats[engine.currentActorSeatIndex].id;
    engine.forfeitSeat(currentId);

    expect(engine.seatById(currentId).eliminated).toBe(true);
    expect(engine.phase).toBe('betting');
    expect(engine.seats[engine.currentActorSeatIndex].id).not.toBe(currentId);

    engine.destroy();
  });

  it('regression: forfeiting a seat that is NOT the current actor does not skip the real current actor\'s turn', () => {
    const players = makeHumans(3, 500);
    const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    for (const s of engine.seats) engine.handleDraw(s.id, []);

    const currentId = engine.seats[engine.currentActorSeatIndex].id;
    const otherSeat = engine.seats.find((s) => s.id !== currentId && s.chips > 0);
    engine.forfeitSeat(otherSeat.id);

    expect(engine.seats[engine.currentActorSeatIndex].id).toBe(currentId);
    expect(engine.seatById(otherSeat.id).eliminated).toBe(true);
    expect(engine.seatById(otherSeat.id).folded).toBe(true);

    engine.destroy();
  });

  it('announce phase: forfeiting the current announcer advances the queue', () => {
    const players = makeHumans(3, 500);
    const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    for (const s of engine.seats) engine.handleDraw(s.id, []);
    checkOrCallThroughBetting(engine);
    expect(engine.phase).toBe('announce');

    const currentId = engine.seats[engine.currentActorSeatIndex].id;
    engine.forfeitSeat(currentId);

    expect(engine.seatById(currentId).eliminated).toBe(true);
    expect(engine.seatById(currentId).folded).toBe(true);
    // Phase is still 'announce' (2 other survivors still need to declare) or
    // has already moved on to 'doubt'/'showdown' if that was the last queue
    // entry — either way it must not still be waiting on the forfeited seat.
    expect(engine.seats[engine.currentActorSeatIndex]?.id).not.toBe(currentId);

    engine.destroy();
  });

  it('announce phase: forfeiting a QUEUED-but-not-yet-reached seat does not hang the hand', () => {
    const players = makeHumans(3, 500);
    const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    for (const s of engine.seats) engine.handleDraw(s.id, []);
    checkOrCallThroughBetting(engine);
    expect(engine.phase).toBe('announce');

    // Forfeit whoever is LAST in the announce queue — not the current actor.
    const lastInQueueId = engine.seats[engine._announceQueue[engine._announceQueue.length - 1]].id;
    expect(lastInQueueId).not.toBe(engine.seats[engine.currentActorSeatIndex].id);
    engine.forfeitSeat(lastInQueueId);
    expect(engine.phase).toBe('announce'); // the other two still haven't announced

    // Let the two real survivors announce normally — when the queue reaches
    // the forfeited seat's position it must be skipped automatically,
    // landing the hand in 'doubt' instead of hanging forever.
    let guard = 0;
    while (engine.phase === 'announce' && guard++ < 10) {
      const actorId = engine.seats[engine.currentActorSeatIndex].id;
      engine.handleAction(actorId, 'announce', { type: 'onePair', rank: '5' });
    }

    expect(engine.phase).toBe('doubt');
    expect(engine.seatById(lastInQueueId).eliminated).toBe(true);

    engine.destroy();
  });

  it('doubt phase: forfeiting the current doubter advances the queue (auto-pass)', () => {
    const players = makeHumans(3, 500);
    const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    for (const s of engine.seats) engine.handleDraw(s.id, []);
    checkOrCallThroughBetting(engine);
    for (let i = 0; i < 3; i++) {
      const actorId = engine.seats[engine.currentActorSeatIndex].id;
      engine.handleAction(actorId, 'announce', { type: 'onePair', rank: '5' });
    }
    expect(engine.phase).toBe('doubt');

    const currentId = engine.seats[engine.currentActorSeatIndex].id;
    engine.forfeitSeat(currentId);

    expect(engine.seatById(currentId).eliminated).toBe(true);
    expect(engine.seatById(currentId).hasDoubted).toBe(true);
    // Must not still be waiting on the forfeited seat's turn.
    if (engine.phase === 'doubt') {
      expect(engine.seats[engine.currentActorSeatIndex].id).not.toBe(currentId);
    } else {
      expect(engine.phase).toBe('showdown');
    }

    engine.destroy();
  });

  it('is idempotent — calling twice on an already-eliminated seat is a no-op', () => {
    const players = makeHumans(3, 500);
    const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    engine.forfeitSeat(engine.seats[0].id);
    expect(() => engine.forfeitSeat(engine.seats[0].id)).not.toThrow();
    engine.destroy();
  });
});

describe('ChoicePokerEngine.forfeitSeat', () => {
  it('ends the game immediately and awards the remaining seat the win', () => {
    const players = makeHumans(2, 500);
    const engine = new ChoicePokerEngine({ players });
    engine.startNextHand();

    engine.forfeitSeat('p0');

    expect(engine.phase).toBe('gameover');
    expect(engine.gameWinnerId).toBe('p1');
    expect(engine.currentActorSeatIndex).toBe(-1);

    engine.destroy();
  });

  it('is idempotent and safe after the game has already ended', () => {
    const players = makeHumans(2, 500);
    const engine = new ChoicePokerEngine({ players });
    engine.startNextHand();

    engine.forfeitSeat('p0');
    expect(() => engine.forfeitSeat('p0')).not.toThrow();
    expect(() => engine.forfeitSeat('p1')).not.toThrow();
    expect(engine.gameWinnerId).toBe('p1'); // unchanged by the later no-op calls

    engine.destroy();
  });
});
