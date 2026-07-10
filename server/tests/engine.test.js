import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameEngine } from '../game/engine.js';
import { getVariant } from '../game/variants/index.js';

const variant = getVariant('texas-holdem');
const plo = getVariant('plo');

function makeBots(count, startingChips) {
  return Array.from({ length: count }, (_, i) => ({
    id: `bot-${i}`,
    name: `บอท ${i}`,
    avatar: null,
    isBot: true,
    chips: startingChips,
  }));
}

async function runToGameOver(engine, maxIterations = 8000) {
  for (let i = 0; i < maxIterations && engine.phase !== 'gameover'; i++) {
    await vi.advanceTimersByTimeAsync(250);
  }
}

describe('GameEngine simulation (all bots, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a 6-player game to completion and conserves total chips', async () => {
    const startingChips = 400;
    const numPlayers = 6;
    const players = makeBots(numPlayers, startingChips);
    const totalStart = numPlayers * startingChips;

    const engine = new GameEngine({ variant, players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    await runToGameOver(engine);

    expect(engine.phase).toBe('gameover');
    expect(engine.winnerId).toBeTruthy();
    const totalEnd = engine.seats.reduce((sum, s) => sum + s.chips, 0);
    expect(totalEnd).toBe(totalStart);

    const winner = engine.seatById(engine.winnerId);
    expect(winner.chips).toBe(totalStart);

    engine.destroy();
  }, 30000);

  it('runs a heads-up (2-player) game to completion and conserves total chips', async () => {
    const startingChips = 300;
    const players = makeBots(2, startingChips);
    const totalStart = 2 * startingChips;

    const engine = new GameEngine({ variant, players, smallBlind: 10, bigBlind: 20 });
    engine.startNextHand();
    await runToGameOver(engine);

    expect(engine.phase).toBe('gameover');
    const totalEnd = engine.seats.reduce((sum, s) => sum + s.chips, 0);
    expect(totalEnd).toBe(totalStart);

    engine.destroy();
  }, 30000);

  it('never lets chip totals drift mid-game across many hands (9 players)', async () => {
    const startingChips = 250;
    const numPlayers = 9;
    const players = makeBots(numPlayers, startingChips);
    const totalStart = numPlayers * startingChips;

    const engine = new GameEngine({ variant, players, smallBlind: 5, bigBlind: 10 });

    // Note: committedTotal is intentionally left populated after showdown
    // (until the next startNextHand() resets it) so the UI can display the
    // final bets/pot during the hand-over pause. By 'hand-over'/'game-over'
    // time, payouts have already landed in `chips`, so only `chips` should
    // be summed here — adding committedTotal too would double-count.
    let handsObserved = 0;
    engine.on('update', ({ reason }) => {
      if (reason === 'hand-over' || reason === 'game-over') {
        handsObserved += 1;
        const total = engine.seats.reduce((sum, s) => sum + s.chips, 0);
        expect(total).toBe(totalStart);
      }
    });

    engine.startNextHand();
    await runToGameOver(engine);

    expect(engine.phase).toBe('gameover');
    expect(handsObserved).toBeGreaterThan(0);
    engine.destroy();
  }, 30000);

  it('runs a 3-player PLO game to completion (4 hole cards, pot-limit betting) and conserves total chips', async () => {
    const startingChips = 400;
    const numPlayers = 3;
    const players = makeBots(numPlayers, startingChips);
    const totalStart = numPlayers * startingChips;

    const engine = new GameEngine({ variant: plo, players, smallBlind: 10, bigBlind: 20 });
    engine.on('update', ({ reason }) => {
      if (reason !== 'hand-start') return;
      for (const seat of engine.seats) {
        if (seat.dealtIn) expect(seat.holeCards).toHaveLength(4);
      }
    });

    engine.startNextHand();
    await runToGameOver(engine);

    expect(engine.phase).toBe('gameover');
    expect(engine.winnerId).toBeTruthy();
    const totalEnd = engine.seats.reduce((sum, s) => sum + s.chips, 0);
    expect(totalEnd).toBe(totalStart);

    engine.destroy();
  }, 60000);
});
