import { evaluateHand } from './handEvaluator.js';
import { HAND_TYPES, rankFromRealHand } from './doubtPokerRankings.js';
import { BOT_PERSONALITIES } from './botProfiles.js';

// Duplicated (not imported) from doubtPokerEngine.js to avoid a circular
// import — this file is imported BY the engine.
const FIVE_CARD_VARIANT = { holeCards: 5, boardCards: 0, holeCardsUsed: null, bettingStructure: 'no-limit' };

const RANK_ORDER = '23456789TJQKA';

function randomRankFor(type) {
  if (type === 'royalFlush') return null;
  return RANK_ORDER[Math.floor(Math.random() * RANK_ORDER.length)];
}

// Decides what to declare after the draw. Mostly honest; a weak hand
// occasionally claims up (scaled by the personality's bluffFreq, capped to a
// plausible-ish overshoot rather than an absurd one), and a genuinely strong
// hand occasionally sandbags down to bait an opponent into paying to Doubt
// (and losing that bet into the pot) — the exact trap the user's rules
// description calls out as the game's signature play.
export function decideDoubtPokerAnnouncement({ hand, personality }) {
  const p = personality || BOT_PERSONALITIES.sharp;
  const evaluated = evaluateHand(hand, [], FIVE_CARD_VARIANT);
  const real = rankFromRealHand(evaluated);
  const realTier = HAND_TYPES.indexOf(real.type);

  if (Math.random() < p.bluffFreq && realTier < HAND_TYPES.length - 1) {
    const maxBump = Math.min(3, HAND_TYPES.length - 1 - realTier);
    const bump = 1 + Math.floor(Math.random() * maxBump);
    const claimedTier = realTier + bump;
    const type = HAND_TYPES[claimedTier];
    return { type, rank: randomRankFor(type) };
  }

  const sandbagChance = realTier >= 6 ? p.aggression * 0.15 : 0; // only a genuinely strong hand is worth baiting with
  if (Math.random() < sandbagChance) {
    const dropTier = Math.max(0, realTier - (1 + Math.floor(Math.random() * 2)));
    const type = HAND_TYPES[dropTier];
    return { type, rank: randomRankFor(type) };
  }

  return real;
}

// Roughly ordered by how rare each hand type actually is in a random 5-card
// hand — a claimed Four of a Kind is far more suspicious than a claimed Pair
// simply because pairs are common and quads are vanishingly rare. Not real
// probabilities, just relative suspicion weights.
const TIER_SUSPICION = {
  highCard: 0.02,
  onePair: 0.05,
  twoPair: 0.15,
  threeOfAKind: 0.3,
  straight: 0.55,
  flush: 0.65,
  fullHouse: 0.75,
  fourOfAKind: 0.9,
  straightFlush: 0.97,
  royalFlush: 0.99,
};

// Bots only ever see a target's PUBLIC announcement here, never their real
// hand — doubting is a judgment call on claim plausibility + personality,
// not a peek at hidden information.
export function decideDoubtPokerDoubt({ seat, targets, doubtCost, pot, personality }) {
  const p = personality || BOT_PERSONALITIES.sharp;
  if (!targets.length || seat.chips < doubtCost) return { targetId: null };

  let best = null;
  let bestScore = -Infinity;
  for (const target of targets) {
    if (!target.announcement) continue;
    const base = TIER_SUSPICION[target.announcement.type] ?? 0.3;
    const score = base * (0.6 + p.aggression * 0.8) + (Math.random() - 0.5) * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = target;
    }
  }
  if (!best) return { targetId: null };

  const costRatio = doubtCost / Math.max(1, pot);
  const threshold = 0.45 + costRatio * 0.3 - p.looseness * 0.2;
  if (bestScore < threshold) return { targetId: null };

  return { targetId: best.id };
}
