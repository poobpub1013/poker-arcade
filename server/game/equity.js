import { randomInt } from 'node:crypto';
import { createDeck } from './deck.js';
import { evaluateHand, determineWinners } from './handEvaluator.js';

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

const DEFAULT_TRIALS = 200;
// Variants that force an exact hole-card count (e.g. Omaha's "exactly 2")
// evaluate every hole×board combination inside evaluateHand — ~60x costlier
// per call than Hold'em's single 7-card solve. Left at 200 trials, an 8-way
// PLO decision takes 4+ seconds of synchronous compute, freezing the whole
// server for that long. Fewer trials keeps worst case under ~350ms; bot
// decisions already carry plenty of their own randomness on top, so the
// extra estimation noise doesn't make them noticeably less sensible.
const EXACT_HOLE_TRIALS = 25;

// Monte Carlo equity: hero's share of the pot against `numOpponents` random
// hands, averaged over many random run-outs of the remaining board. This is
// what lets the bot AI value drawing hands correctly (a flush draw isn't
// "just high card" the way a naive rank-based check would see it) without
// needing a precomputed range chart.
export function estimateEquity({ holeCards, board, numOpponents, variant, trials }) {
  if (numOpponents <= 0) return 1;

  const effectiveTrials = trials ?? (variant.holeCardsUsed?.exactly ? EXACT_HOLE_TRIALS : DEFAULT_TRIALS);

  const known = new Set([...holeCards, ...board]);
  const remainingDeck = createDeck().filter((c) => !known.has(c));
  const boardNeeded = variant.boardCards - board.length;
  const cardsPerTrial = boardNeeded + numOpponents * variant.holeCards;
  if (cardsPerTrial > remainingDeck.length) return 0.5;

  let winShare = 0;

  for (let t = 0; t < effectiveTrials; t++) {
    const draw = drawRandom(remainingDeck, cardsPerTrial);
    let idx = 0;
    const fullBoard = [...board, ...draw.slice(idx, idx + boardNeeded)];
    idx += boardNeeded;

    const resultsById = new Map();
    resultsById.set('hero', evaluateHand(holeCards, fullBoard, variant));
    const contenderIds = ['hero'];

    for (let o = 0; o < numOpponents; o++) {
      const oppHole = draw.slice(idx, idx + variant.holeCards);
      idx += variant.holeCards;
      resultsById.set(`opp${o}`, evaluateHand(oppHole, fullBoard, variant));
      contenderIds.push(`opp${o}`);
    }

    const winners = determineWinners(resultsById, contenderIds);
    if (winners.includes('hero')) {
      winShare += 1 / winners.length;
    }
  }

  return winShare / effectiveTrials;
}
