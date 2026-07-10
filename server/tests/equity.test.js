import { describe, it, expect } from 'vitest';
import { estimateEquity } from '../game/equity.js';
import { getVariant } from '../game/variants/index.js';

const holdem = getVariant('texas-holdem');

describe('estimateEquity (Monte Carlo)', () => {
  it('gives pocket aces a big edge heads-up preflop (~85% actual)', () => {
    const equity = estimateEquity({
      holeCards: ['Ah', 'Ad'],
      board: [],
      numOpponents: 1,
      variant: holdem,
      trials: 3000,
    });
    expect(equity).toBeGreaterThan(0.75);
    expect(equity).toBeLessThan(0.93);
  });

  it('gives 7-2 offsuit (the worst hand) poor heads-up equity (~35% actual)', () => {
    const equity = estimateEquity({
      holeCards: ['7c', '2d'],
      board: [],
      numOpponents: 1,
      variant: holdem,
      trials: 3000,
    });
    expect(equity).toBeGreaterThan(0.24);
    expect(equity).toBeLessThan(0.46);
  });

  it('gives an unbeatable made hand ~100% equity on a complete board', () => {
    const equity = estimateEquity({
      holeCards: ['Ah', 'Kh'],
      board: ['Qh', 'Jh', 'Th', '2c', '3d'], // royal flush
      numOpponents: 2,
      variant: holdem,
      trials: 500,
    });
    expect(equity).toBeCloseTo(1, 1);
  });

  it('reduces equity as more opponents are added', () => {
    const headsUp = estimateEquity({
      holeCards: ['Th', '9h'],
      board: [],
      numOpponents: 1,
      variant: holdem,
      trials: 2000,
    });
    const sixHanded = estimateEquity({
      holeCards: ['Th', '9h'],
      board: [],
      numOpponents: 5,
      variant: holdem,
      trials: 2000,
    });
    expect(sixHanded).toBeLessThan(headsUp);
  });

  it('recognizes a strong draw as much better than a made-but-weak high card', () => {
    // Nine outs to the nut flush on the flop should beat a bare ace-high hand.
    const flushDraw = estimateEquity({
      holeCards: ['Ah', 'Kh'],
      board: ['2h', '7h', '9c'],
      numOpponents: 1,
      variant: holdem,
      trials: 2000,
    });
    const aceHigh = estimateEquity({
      holeCards: ['Ad', '4c'],
      board: ['2h', '7h', '9c'],
      numOpponents: 1,
      variant: holdem,
      trials: 2000,
    });
    expect(flushDraw).toBeGreaterThan(aceHigh);
  });
});
