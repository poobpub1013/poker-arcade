// Doubt Poker's announcement model: a claim is {type, rank} — a hand type
// (one of the 10 below) plus a single representative card rank, e.g.
// { type: 'onePair', rank: 'K' } = "Pair of Kings". This mirrors both the
// standard pokersolver 'standard' ruleset's rank 1..9 (High Card..Straight
// Flush) and the user's explicit 10-item list, with Royal Flush split out as
// a synthetic top tier the same way handEvaluator.js already upgrades its
// display name.
export const HAND_TYPES = [
  'highCard',
  'onePair',
  'twoPair',
  'threeOfAKind',
  'straight',
  'flush',
  'fullHouse',
  'fourOfAKind',
  'straightFlush',
  'royalFlush',
];

const RANK_ORDER = '23456789TJQKA';

function tierIndex(type) {
  const i = HAND_TYPES.indexOf(type);
  if (i === -1) throw new Error(`Unknown hand type: ${type}`);
  return i;
}

function rankValue(rank) {
  if (rank == null) return 0;
  const v = RANK_ORDER.indexOf(rank);
  if (v === -1) throw new Error(`Unknown rank: ${rank}`);
  return v;
}

// Converts a real evaluated 5-card hand (the wrapped shape returned by
// handEvaluator.js's evaluateHand — { hand, name, description, bestFive })
// into the same {type, rank} shape as a player's announcement, so the two
// can be compared directly. `hand.cards[0].value` reliably gives exactly the
// "representative rank" for every hand type under pokersolver's card
// ordering (the paired rank for a pair, the higher pair for two pair, the
// trips rank for a full house, the high card for a straight/flush/high
// card, etc.) — verified empirically against pokersolver's actual output.
export function rankFromRealHand(evaluated) {
  const tierFromRank = evaluated.hand.rank - 1; // pokersolver 'standard' rank is 1..9
  const tier = evaluated.name === 'Royal Flush' ? HAND_TYPES.indexOf('royalFlush') : tierFromRank;
  const type = HAND_TYPES[tier];
  const rank = type === 'royalFlush' ? null : evaluated.hand.cards[0].value;
  return { type, rank };
}

// Compares two {type, rank} claims (real or announced). Positive if `a` is
// stronger, negative if weaker, 0 if equal.
export function compareClaims(a, b) {
  const tierDiff = tierIndex(a.type) - tierIndex(b.type);
  if (tierDiff !== 0) return tierDiff;
  return rankValue(a.rank) - rankValue(b.rank);
}

// An announcement is a lie only if the real hand is strictly WORSE than
// claimed — matching an honest claim, or genuinely underclaiming
// ("sandbagging"), both count as truthful per the game's rules.
export function isTruthful(announcement, evaluatedRealHand) {
  const real = rankFromRealHand(evaluatedRealHand);
  return compareClaims(real, announcement) >= 0;
}

export function isValidClaim({ type, rank }) {
  if (!HAND_TYPES.includes(type)) return false;
  if (type === 'royalFlush') return rank == null;
  return typeof rank === 'string' && RANK_ORDER.includes(rank);
}
