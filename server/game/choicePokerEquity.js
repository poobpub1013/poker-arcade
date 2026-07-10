import { randomInt } from 'node:crypto';
import { createDeckWithJoker } from './choicePokerDeck.js';
import { evaluateChoiceHand, compareByDirection } from './choicePokerHandEvaluator.js';

function drawRandom(pool, count) {
  const arr = pool.slice();
  const n = arr.length;
  const take = Math.min(count, n);
  const result = [];
  for (let i = 0; i < take; i++) {
    const j = i + randomInt(n - i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
    result.push(arr[i]);
  }
  return result;
}

const TRIALS = 150;

// Estimates how often `myHand` beats a random completion of the opponent's
// only-partially-known hand. `opponentKnownHand` is a 5-slot array with the
// opponent's genuinely-visible cards (the ones they drew as replacements)
// and `null` for slots they kept hidden — same shape the client receives,
// same restricted view a human opponent would have. Returns win-rate
// estimates for BOTH directions so the caller can pick whichever favors it
// and size confidence accordingly. Cheap per trial (one plain 5-card solve
// each side, no Omaha-style combinatorics), so a few hundred trials is fast.
export function estimateChoicePokerEquity({ myHand, opponentKnownHand }) {
  const known = new Set([...myHand, ...opponentKnownHand.filter(Boolean)]);
  const hiddenSlots = opponentKnownHand.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
  const myResult = evaluateChoiceHand(myHand);

  if (hiddenSlots.length === 0) {
    const oppResult = evaluateChoiceHand(opponentKnownHand);
    return {
      winRateStronger: outcomeScore(compareByDirection(myResult, oppResult, 'stronger')),
      winRateWeaker: outcomeScore(compareByDirection(myResult, oppResult, 'weaker')),
    };
  }

  const unseenPool = createDeckWithJoker().filter((c) => !known.has(c));
  let strongerWins = 0;
  let weakerWins = 0;

  for (let t = 0; t < TRIALS; t++) {
    const sampled = drawRandom(unseenPool, hiddenSlots.length);
    const opponentHand = [...opponentKnownHand];
    hiddenSlots.forEach((slot, i) => {
      opponentHand[slot] = sampled[i];
    });
    const oppResult = evaluateChoiceHand(opponentHand);
    strongerWins += outcomeScore(compareByDirection(myResult, oppResult, 'stronger'));
    weakerWins += outcomeScore(compareByDirection(myResult, oppResult, 'weaker'));
  }

  return { winRateStronger: strongerWins / TRIALS, winRateWeaker: weakerWins / TRIALS };
}

function outcomeScore(outcome) {
  if (outcome === 'a') return 1;
  if (outcome === 'tie') return 0.5;
  return 0;
}
