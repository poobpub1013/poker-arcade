import { describe, it, expect, vi, afterEach } from 'vitest';
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

// These two hands are an exact tie (same ranks 2-4-5-9-Q, different suits, no
// flush) -- with both hands fully revealed, estimateChoicePokerEquity skips its
// Monte Carlo sampling entirely and returns exactly 0.5 for both directions, no
// crypto RNG involved. Combined with mocking Math.random (which only feeds the
// small noise/mistake-rate jitter in decideChoicePokerBet itself), this makes
// confidence, and everything derived from it, exactly reproducible.
const TIE_HAND_A = ['2H', '5D', '9C', 'QS', '4C'];
const TIE_HAND_B = ['2D', '5H', '9S', 'QC', '4D'];

describe('decideChoicePokerBet — never bets more than the opponent could ever match', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('regression: two fresh, equal starting stacks open gradually — a healthy opponent stack is not something to pressure', () => {
    // Two players sitting down with 1000 each should not read the opponent's
    // full 1000-chip stack as "pressure them for ~40-60% of it" on the very
    // first bet of the match, before any edge has even been established.
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // neutralizes noise/mistake jitter

    for (const [name, personality] of Object.entries(BOT_PERSONALITIES)) {
      const decision = decideChoicePokerBet({
        myHand: TIE_HAND_A,
        opponentKnownHand: TIE_HAND_B,
        currentBet: 0,
        isOpening: true,
        myStackTotal: 1000,
        opponentStackTotal: 1000,
        personality,
        startingChips: 1000,
      });
      expect(decision.action).toBe('raise');
      // Pure self-based opening sizing tops out around 12% of the stack even
      // for the most aggressive personality.
      expect(decision.amount, `${name} opened too big for a fresh, even stack`).toBeLessThan(150);
    }
  });

  it('regression: a confident bot with a much bigger stack caps its raise at exactly what a short opponent could match, not a wasteful multiple of it', () => {
    // This is the shape of the actual bug that slipped through the ceiling-cap
    // fix: a 5000-stack bot facing a 100-stack opponent can have plenty of
    // confidence (and therefore plenty of risk ceiling) to justify a raise far
    // beyond 100 -- but anything past 100 is pure wasted risk, since the
    // opponent is already fully unable to raise back at exactly 100. A bot
    // that doesn't know this will happily raise to 1000+ to "win" a sub-100
    // chip ante, and occasionally torches its own stack doing it.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const decision = decideChoicePokerBet({
      myHand: TIE_HAND_A,
      opponentKnownHand: TIE_HAND_B,
      currentBet: 0,
      isOpening: true,
      myStackTotal: 5000,
      opponentStackTotal: 100,
      personality: BOT_PERSONALITIES.station,
      startingChips: 5000,
    });

    expect(decision.action).toBe('raise');
    expect(decision.amount).toBe(100); // exactly the opponent's whole stack -- fully denies them, nothing wasted
  });

  it('a genuinely short opponent still gets a decisive open, even from a bot with only a modest lead', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const decision = decideChoicePokerBet({
      myHand: TIE_HAND_A,
      opponentKnownHand: TIE_HAND_B,
      currentBet: 0,
      isOpening: true,
      myStackTotal: 300,
      opponentStackTotal: 100,
      personality: BOT_PERSONALITIES.station, // lowest aggression
      startingChips: 1000,
    });

    expect(decision.action).toBe('raise');
    expect(decision.amount).toBe(20); // self-based sizing here (300 * ~6.6%) already lands under the opponent's 100
  });

  it('still never raises beyond its own stack even when the opponent has far more', () => {
    for (let i = 0; i < 20; i++) {
      const decision = decideChoicePokerBet({
        myHand: WEAK_HAND,
        opponentKnownHand: HIDDEN_OPPONENT,
        currentBet: 5,
        isOpening: false,
        myStackTotal: 30, // bot is the short stack here
        opponentStackTotal: 5000,
        personality: BOT_PERSONALITIES.brawler,
        startingChips: 3000,
      });
      if (decision.action === 'raise') expect(decision.amount).toBeLessThanOrEqual(30);
    }
  });
});
