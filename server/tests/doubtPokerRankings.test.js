import { describe, it, expect } from 'vitest';
import { evaluateHand } from '../game/handEvaluator.js';
import { rankFromRealHand, compareClaims, isTruthful, isValidClaim, HAND_TYPES } from '../game/doubtPokerRankings.js';

const variant = { holeCardsUsed: null };
const evalHand = (cards) => evaluateHand(cards, [], variant);

describe('doubtPokerRankings', () => {
  it('extracts type + representative rank from real hands', () => {
    expect(rankFromRealHand(evalHand(['Kh', 'Kd', '7h', '9s', '2c']))).toEqual({ type: 'onePair', rank: 'K' });
    expect(rankFromRealHand(evalHand(['Kh', 'Kd', '2h', '2s', '9c']))).toEqual({ type: 'twoPair', rank: 'K' });
    expect(rankFromRealHand(evalHand(['Ah', 'Ad', 'Ac', '7s', '2c']))).toEqual({ type: 'threeOfAKind', rank: 'A' });
    expect(rankFromRealHand(evalHand(['Kh', 'Kd', 'Kc', '2s', '2c']))).toEqual({ type: 'fullHouse', rank: 'K' });
    expect(rankFromRealHand(evalHand(['9h', '9d', '9c', '9s', '2c']))).toEqual({ type: 'fourOfAKind', rank: '9' });
    expect(rankFromRealHand(evalHand(['Th', 'Jh', 'Qh', 'Kh', 'Ah']))).toEqual({ type: 'royalFlush', rank: null });
  });

  it('ranks hand types in the standard order, high card weakest', () => {
    for (let i = 0; i < HAND_TYPES.length - 1; i++) {
      const weaker = { type: HAND_TYPES[i], rank: 'A' };
      const stronger = { type: HAND_TYPES[i + 1], rank: '2' };
      expect(compareClaims(stronger, weaker)).toBeGreaterThan(0);
    }
  });

  it('breaks ties within the same type by rank', () => {
    expect(compareClaims({ type: 'onePair', rank: 'K' }, { type: 'onePair', rank: '2' })).toBeGreaterThan(0);
    expect(compareClaims({ type: 'onePair', rank: '2' }, { type: 'onePair', rank: 'K' })).toBeLessThan(0);
    expect(compareClaims({ type: 'onePair', rank: 'K' }, { type: 'onePair', rank: 'K' })).toBe(0);
  });

  it('a claim matching or exceeding the real hand is truthful', () => {
    const pairKings = evalHand(['Kh', 'Kd', '7h', '9s', '2c']);
    expect(isTruthful({ type: 'onePair', rank: 'K' }, pairKings)).toBe(true);
  });

  it('under-claiming ("sandbagging") is truthful, not a lie', () => {
    const fullHouse = evalHand(['Kh', 'Kd', 'Kc', '2s', '2c']);
    expect(isTruthful({ type: 'onePair', rank: '2' }, fullHouse)).toBe(true);
  });

  it('claiming a type you do not have at all is a lie', () => {
    const highCard = evalHand(['2c', '5d', '7h', '9s', 'Jc']);
    expect(isTruthful({ type: 'onePair', rank: 'K' }, highCard)).toBe(false);
  });

  it('claiming the same type but a rank you do not have is a lie', () => {
    const pairKings = evalHand(['Kh', 'Kd', '7h', '9s', '2c']);
    expect(isTruthful({ type: 'onePair', rank: 'A' }, pairKings)).toBe(false);
  });

  it('validates claim shape, including the royal-flush no-rank rule', () => {
    expect(isValidClaim({ type: 'onePair', rank: 'K' })).toBe(true);
    expect(isValidClaim({ type: 'royalFlush', rank: null })).toBe(true);
    expect(isValidClaim({ type: 'royalFlush', rank: 'K' })).toBe(false);
    expect(isValidClaim({ type: 'nonsense', rank: 'K' })).toBe(false);
    expect(isValidClaim({ type: 'onePair', rank: 'Z' })).toBe(false);
  });
});
