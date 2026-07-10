import { describe, it, expect } from 'vitest';
import { evaluateChoiceHand, compareByDirection } from '../game/choicePokerHandEvaluator.js';

describe('choicePokerHandEvaluator', () => {
  it('recognizes One Pair correctly (unlike pokersolver\'s built-in "joker" ruleset, which drops it)', () => {
    const result = evaluateChoiceHand(['2c', '2d', '7h', '9s', 'Kc']);
    expect(result.name).toBe('Pair');
  });

  it('resolves the joker to complete Five of a Kind, ranked above Straight Flush', () => {
    const fiveKind = evaluateChoiceHand(['Kh', 'Kd', 'Kc', 'Ks', 'Oj']);
    expect(fiveKind.name).toBe('Five of a Kind');

    const royal = evaluateChoiceHand(['Th', 'Jh', 'Qh', 'Kh', 'Ah']);
    expect(royal.description).toBe('Royal Flush');

    expect(compareByDirection(fiveKind, royal, 'stronger')).toBe('a');
  });

  it('resolves the joker to complete a flush when that is the best use of it', () => {
    const result = evaluateChoiceHand(['2h', '5h', '7h', '9h', 'Oj']);
    expect(result.name).toBe('Flush');
  });

  it('"stronger" direction picks the higher-ranked hand', () => {
    const pair = evaluateChoiceHand(['2c', '2d', '7h', '9s', 'Kc']);
    const highCard = evaluateChoiceHand(['2c', '5d', '7h', '9s', 'Jc']);
    expect(compareByDirection(pair, highCard, 'stronger')).toBe('a');
  });

  it('"weaker" direction picks the lower-ranked hand', () => {
    const pair = evaluateChoiceHand(['2c', '2d', '7h', '9s', 'Kc']);
    const highCard = evaluateChoiceHand(['2c', '5d', '7h', '9s', 'Jc']);
    expect(compareByDirection(pair, highCard, 'weaker')).toBe('b');
  });

  it('detects an exact tie regardless of direction', () => {
    const a = evaluateChoiceHand(['2c', '7d', '9h', 'Jc', 'Ks']);
    const b = evaluateChoiceHand(['2h', '7s', '9d', 'Jh', 'Kc']);
    expect(compareByDirection(a, b, 'stronger')).toBe('tie');
    expect(compareByDirection(a, b, 'weaker')).toBe('tie');
  });
});
