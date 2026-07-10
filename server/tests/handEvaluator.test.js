import { describe, it, expect } from 'vitest';
import { evaluateHand, determineWinners } from '../game/handEvaluator.js';
import { getVariant } from '../game/variants/index.js';

const holdem = getVariant('texas-holdem');
const plo = {
  id: 'plo',
  holeCardsUsed: { exactly: 2 },
};

describe("handEvaluator - Texas Hold'em", () => {
  it('recognizes a royal flush using the board', () => {
    const result = evaluateHand(['2c', '3d'], ['Tc', 'Jc', 'Qc', 'Kc', 'Ac'], holdem);
    expect(result.name).toBe('Royal Flush');
  });

  it('recognizes a straight flush', () => {
    const result = evaluateHand(['5c', '6c'], ['7c', '8c', '9c', '2d', '3h'], holdem);
    expect(result.name).toBe('Straight Flush');
  });

  it('handles the wheel straight (A-2-3-4-5) as the lowest straight', () => {
    const result = evaluateHand(['Ah', '2d'], ['3c', '4s', '5h', '9d', 'Kc'], holdem);
    expect(result.name).toBe('Straight');
    expect(result.description.toLowerCase()).toContain('5');
  });

  it('handles the Broadway straight (10-J-Q-K-A) as the highest straight', () => {
    const result = evaluateHand(['Th', 'Jd'], ['Qc', 'Ks', 'Ah', '2d', '3c'], holdem);
    expect(result.name).toBe('Straight');
  });

  it('picks best 5 of 7 and ignores worse kickers', () => {
    // Board plays: quad kings on board, kicker is the best of remaining cards.
    const result = evaluateHand(['2c', '3d'], ['Kh', 'Kc', 'Kd', 'Ks', 'Ah'], holdem);
    expect(result.name).toBe('Four of a Kind');
  });

  it('breaks ties on kickers between two players', () => {
    const board = ['2c', '7d', '9h', 'Jc', 'Ks'];
    const strong = evaluateHand(['Ah', 'Qd'], board, holdem); // pair of kings, A kicker
    const weak = evaluateHand(['Ac', 'Th'], board, holdem); // pair of kings, lower kicker structure
    const resultsById = new Map([
      ['strong', strong],
      ['weak', weak],
    ]);
    const winners = determineWinners(resultsById, ['strong', 'weak']);
    expect(winners).toEqual(['strong']);
  });

  it('detects a split pot when hands are truly equal', () => {
    const board = ['2c', '7d', '9h', 'Jc', 'As'];
    const p1 = evaluateHand(['Kh', '3d'], board, holdem);
    const p2 = evaluateHand(['Ks', '3c'], board, holdem);
    const resultsById = new Map([
      ['p1', p1],
      ['p2', p2],
    ]);
    const winners = determineWinners(resultsById, ['p1', 'p2']);
    expect(winners.sort()).toEqual(['p1', 'p2']);
  });
});

describe('handEvaluator - PLO (must use exactly 2 hole cards)', () => {
  it('cannot use 3+ hole cards even if it would make a better hand', () => {
    // Hole has 4 clubs -> flush if all could be used, but Omaha forces exactly 2 hole + 3 board.
    const result = evaluateHand(['2c', '5c', '8c', 'Jc'], ['3c', '4c', '9d', 'Kh', '2d'], plo);
    // Using 2c+5c (or others) with 3c+4c board gives a straight/flush possibilities;
    // it must NOT be a 5-card club flush using 4 hole clubs (that would need 4 hole cards).
    expect(result.bestFive.filter((c) => c.endsWith('c')).length).toBeLessThanOrEqual(3);
  });

  it('finds the best valid 2-hole-card combination', () => {
    // Hole: pair of aces + junk. Board makes trips using one hole ace + two board aces impossible
    // (only 1 ace left on board) so best should combine hole pair with board.
    const result = evaluateHand(['Ah', 'Ad', '2c', '7s'], ['As', 'Kd', 'Qc', '5h', '3d'], plo);
    expect(result.name).toBe('Three of a Kind');
  });
});
