import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DoubtPokerEngine } from '../game/doubtPokerEngine.js';

function makeBots(count, startingChips) {
  return Array.from({ length: count }, (_, i) => ({
    id: `bot-${i}`,
    name: `บอท ${i}`,
    avatar: null,
    isBot: true,
    chips: startingChips,
  }));
}

function makeHumans(count, startingChips) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    avatar: null,
    isBot: false,
    chips: startingChips,
  }));
}

async function runToGameOver(engine, maxIterations = 12000) {
  for (let i = 0; i < maxIterations && engine.phase !== 'gameover'; i++) {
    await vi.advanceTimersByTimeAsync(250);
  }
}

// Drives betting to close by having whoever's turn it is check/call, no
// raises — used by the controlled scenarios below where we only care about
// the announce/doubt resolution, not the betting itself.
function checkOrCallThroughBetting(engine) {
  let guard = 0;
  while (engine.phase === 'betting' && guard++ < 20) {
    const actorId = engine.seats[engine.currentActorSeatIndex].id;
    const legal = engine.getLegalActions(actorId);
    engine.handleAction(actorId, legal.canCheck ? 'check' : 'call');
  }
}

describe('DoubtPokerEngine', () => {
  it('rejects fewer than 2 or more than 6 players', () => {
    expect(() => new DoubtPokerEngine({ players: makeBots(1, 500), smallBlind: 10, bigBlind: 20 })).toThrow();
    expect(() => new DoubtPokerEngine({ players: makeBots(7, 500), smallBlind: 10, bigBlind: 20 })).toThrow();
  });

  describe('controlled scenarios (manual actions, real timers)', () => {
    it('eliminates a caught liar from the pot while their bet stays in it', () => {
      const players = makeHumans(2, 500);
      const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
      engine.startNextHand();
      engine.handleAction('p0', 'draw', []);
      engine.handleAction('p1', 'draw', []);
      checkOrCallThroughBetting(engine);
      expect(engine.phase).toBe('announce');

      // p0 is dealt garbage but lies and claims Four of a Kind Kings.
      const p0 = engine.seatById('p0');
      p0.holeCards = ['2c', '5d', '7h', '9s', 'Jc'];

      const first = engine.seats[engine.currentActorSeatIndex].id;
      const second = first === 'p0' ? 'p1' : 'p0';
      const claims = { p0: { type: 'fourOfAKind', rank: 'K' }, p1: { type: 'onePair', rank: '5' } };
      engine.handleAction(first, 'announce', claims[first]);
      engine.handleAction(second, 'announce', claims[second]);
      expect(engine.phase).toBe('doubt');

      // Whoever's turn it is, get to p1 doubting p0 (p0 passes on their own turn if it comes first).
      if (engine.seats[engine.currentActorSeatIndex].id === 'p0') engine.handleAction('p0', 'pass');
      engine.handleAction('p1', 'doubt', 'p0');

      expect(engine.seatById('p0').liar).toBe(true);
      expect(engine.seatById('p0').revealed).toBe(true);
      expect(engine.lastResult.pots).toHaveLength(1);
      expect(engine.lastResult.pots[0].winners).toEqual(['p1']);
      // Pot = both blinds (20 total) + the doubt cost (20) p1 paid — none of
      // that money disappears even though p0 (who contributed 20 of it) is
      // barred from winning it.
      expect(engine.lastResult.pots[0].amount).toBe(60);

      engine.destroy();
    });

    it('an undoubted lie wins at showdown using the false announced hand, not the real one', () => {
      const players = makeHumans(2, 500);
      const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
      engine.startNextHand();
      engine.handleAction('p0', 'draw', []);
      engine.handleAction('p1', 'draw', []);
      checkOrCallThroughBetting(engine);

      const p0 = engine.seatById('p0');
      p0.holeCards = ['2c', '5d', '7h', '9s', 'Jc']; // real hand: nothing
      const p1 = engine.seatById('p1');
      p1.holeCards = ['Kh', 'Kd', 'Kc', '2s', '2c']; // real hand: genuine full house

      const first = engine.seats[engine.currentActorSeatIndex].id;
      const second = first === 'p0' ? 'p1' : 'p0';
      const claims = { p0: { type: 'straightFlush', rank: '9' }, p1: { type: 'fullHouse', rank: 'K' } };
      engine.handleAction(first, 'announce', claims[first]);
      engine.handleAction(second, 'announce', claims[second]);

      // Both pass — nobody calls out p0's absurd claim.
      engine.handleAction(engine.seats[engine.currentActorSeatIndex].id, 'pass');
      engine.handleAction(engine.seats[engine.currentActorSeatIndex].id, 'pass');

      expect(engine.seatById('p0').liar).toBe(false);
      expect(engine.seatById('p0').revealed).toBe(false);
      // p0's claimed Straight Flush beats p1's real (and truthfully
      // announced) Full House — the lie stands because nobody challenged it.
      expect(engine.lastResult.pots[0].winners).toEqual(['p0']);

      engine.destroy();
    });

    it('rejects doubting a player who has already been revealed, and rejects a raise below the minimum', () => {
      const players = makeHumans(3, 500);
      const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });
      engine.startNextHand();
      for (const p of players) engine.handleAction(p.id, 'draw', []);

      // Below-minimum raise is rejected (min raise = currentBet + bigBlind).
      const opener = engine.seats[engine.currentActorSeatIndex].id;
      expect(() => engine.handleAction(opener, 'raise', engine.currentBet + 1)).toThrow();
      checkOrCallThroughBetting(engine);
      expect(engine.phase).toBe('announce');

      for (let i = 0; i < 3; i++) {
        const actorId = engine.seats[engine.currentActorSeatIndex].id;
        engine.handleAction(actorId, 'announce', { type: 'onePair', rank: '5' });
      }
      expect(engine.phase).toBe('doubt');

      // Doubt turn order starts at the dealer (p0 for hand 1) and proceeds
      // in seat order [p0, p1, p2] — deterministic since nobody folded.
      // p0 doubts p2 (skipping p1), revealing p2 either way.
      expect(engine.seats[engine.currentActorSeatIndex].id).toBe('p0');
      engine.handleAction('p0', 'doubt', 'p2');
      expect(engine.seatById('p2').revealed).toBe(true);

      // p1 is next in the queue (hasn't acted or been eliminated yet) and
      // may not target p2 again — p2 is already revealed.
      expect(engine.seats[engine.currentActorSeatIndex].id).toBe('p1');
      expect(() => engine.handleAction('p1', 'doubt', 'p2')).toThrow();

      engine.destroy();
    });
  });

  describe('bot-vs-bot simulation (fake timers)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('runs a 4-player game to completion, conserving total chips throughout', async () => {
      const startingChips = 400;
      const numPlayers = 4;
      const players = makeBots(numPlayers, startingChips);
      const totalStart = numPlayers * startingChips;

      const engine = new DoubtPokerEngine({ players, smallBlind: 10, bigBlind: 20 });

      let sawAnnounce = false;
      let sawDoubtPhase = false;
      let sawAtLeastOneDoubtAttempt = false;
      let handsObserved = 0;

      engine.on('update', ({ reason }) => {
        if (engine.phase === 'announce') sawAnnounce = true;
        if (engine.phase === 'doubt') sawDoubtPhase = true;
        if (reason === 'doubt-resolved') sawAtLeastOneDoubtAttempt = true;
        if (reason === 'hand-over' || reason === 'game-over') {
          handsObserved += 1;
          const total = engine.seats.reduce((sum, s) => sum + s.chips, 0);
          expect(total).toBe(totalStart);
        }
      });

      engine.startNextHand();
      await runToGameOver(engine);

      expect(engine.phase).toBe('gameover');
      expect(engine.winnerId).toBeTruthy();
      expect(sawAnnounce).toBe(true);
      expect(sawDoubtPhase).toBe(true);
      expect(handsObserved).toBeGreaterThan(0);

      const totalEnd = engine.seats.reduce((sum, s) => sum + s.chips, 0);
      expect(totalEnd).toBe(totalStart);
      const winner = engine.seatById(engine.winnerId);
      expect(winner.chips).toBe(totalStart);

      // Not a hard requirement of any single run, but with enough hands in a
      // 4-bot game some doubt should occur — surfaced as a soft signal, not
      // an assertion, since bot behavior is randomized.
      if (!sawAtLeastOneDoubtAttempt) {
        // eslint-disable-next-line no-console
        console.warn('No doubt attempts observed in this run (RNG-dependent, not necessarily a bug).');
      }

      engine.destroy();
    }, 60000);
  });
});
