import { describe, it, expect } from 'vitest';
import { decideChoicePokerBet } from '../game/choicePokerBot.js';
import { BOT_PERSONALITIES } from '../game/botProfiles.js';

const WEAK_HAND = ['2H', '5D', '9C', 'QS', '4C']; // no pair, no flush/straight draw
const HIDDEN_OPPONENT = [null, null, null, null, null];

describe('decideChoicePokerBet — short-stack push/fold adjustment', () => {
  it('a healthy stack (near 100% of starting) facing a bet beyond its ceiling mostly stands with a weak hand', () => {
    let shoves = 0;
    const trials = 40;
    for (let i = 0; i < trials; i++) {
      const decision = decideChoicePokerBet({
        myHand: WEAK_HAND,
        opponentKnownHand: HIDDEN_OPPONENT,
        currentBet: 400,
        isOpening: false,
        myStackTotal: 500,
        personality: BOT_PERSONALITIES.careful,
        startingChips: 500, // stackRatio = 1 → no short-stack boost
      });
      if (decision.action === 'raise') shoves++;
    }
    expect(shoves / trials).toBeLessThan(0.3);
  });

  it('a felted stack (well under 25% of starting) shoves far more readily instead of bleeding away for good, even with a weak hand and a tight personality', () => {
    let shoves = 0;
    const trials = 40;
    for (let i = 0; i < trials; i++) {
      const decision = decideChoicePokerBet({
        myHand: WEAK_HAND,
        opponentKnownHand: HIDDEN_OPPONENT,
        currentBet: 5,
        isOpening: false,
        myStackTotal: 5, // 1% of starting stack
        personality: BOT_PERSONALITIES.careful, // even the tightest personality
        startingChips: 500,
      });
      if (decision.action === 'raise') shoves++;
      else expect(decision.action).toBe('stand');
    }
    expect(shoves / trials).toBeGreaterThan(0.7);
  });

  it('never raises to more than its own stack total, at any stack depth', () => {
    for (let i = 0; i < 40; i++) {
      const myStackTotal = 5 + Math.floor(Math.random() * 50);
      const decision = decideChoicePokerBet({
        myHand: WEAK_HAND,
        opponentKnownHand: HIDDEN_OPPONENT,
        currentBet: Math.floor(Math.random() * myStackTotal),
        isOpening: false,
        myStackTotal,
        personality: BOT_PERSONALITIES.brawler,
        startingChips: 500,
      });
      if (decision.action === 'raise') {
        expect(decision.amount).toBeLessThanOrEqual(myStackTotal);
        expect(decision.amount).toBeGreaterThan(0);
      }
    }
  });
});
