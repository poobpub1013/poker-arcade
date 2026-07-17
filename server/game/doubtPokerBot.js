import { evaluateHand } from './handEvaluator.js';
import { HAND_TYPES, rankFromRealHand } from './doubtPokerRankings.js';
import { effectivePersonality } from './bots.js';

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
export function decideDoubtPokerAnnouncement({ hand, seat, personality }) {
  const p = effectivePersonality(seat, personality);
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

// How many copies of the claimed rank the claimed hand type locks up. Only
// the of-a-kind family gives clean blocker math; straights/flushes spread
// across too many ranks for held cards to say much.
const OF_A_KIND_NEED = { onePair: 2, twoPair: 2, threeOfAKind: 3, fullHouse: 3, fourOfAKind: 4 };

// Card-counting with the bot's OWN hand (the one hidden thing it legitimately
// knows): a claim of "three Kings" while the bot is holding two Kings can't
// be literally true — only 4 exist. Since announcements are lower bounds
// (sandbagging down is legal), a blocked claim isn't a *guaranteed* lie —
// the target would need an even better hand to be safe — so it's a heavy
// suspicion boost, not automatic certainty.
function blockerBoost(myCards, announcement) {
  const need = OF_A_KIND_NEED[announcement.type];
  if (!need || !announcement.rank) return 0;
  const held = myCards.filter((c) => c[0] === announcement.rank).length;
  if (held === 0) return 0;
  if (4 - held < need) return 1.2; // claim can't be literally true
  return held * 0.18; // each held copy shrinks their possible combos
}

// The draw exchange is public, like physically taking cards at a real table:
// standing pat backs a big claim up, while "drew 3, found a full house" is
// the classic tall tale.
function drawCountBoost(target, tier) {
  const drawn = target.drawnCount;
  if (typeof drawn !== 'number' || tier < HAND_TYPES.indexOf('straight')) return 0;
  return drawn === 0 ? -0.08 : drawn * 0.07;
}

// Bots only ever see a target's PUBLIC announcement and draw count here,
// never their real hand — doubting is a judgment call on claim plausibility
// (weighed against the bot's own cards) + personality, not a peek at hidden
// information.
export function decideDoubtPokerDoubt({ seat, targets, doubtCost, pot, personality }) {
  const p = effectivePersonality(seat, personality);
  if (!targets.length || seat.chips < doubtCost) return { targetId: null };

  let best = null;
  let bestScore = -Infinity;
  for (const target of targets) {
    if (!target.announcement) continue;
    const tier = HAND_TYPES.indexOf(target.announcement.type);
    const base = TIER_SUSPICION[target.announcement.type] ?? 0.3;
    const evidence = blockerBoost(seat.holeCards, target.announcement) + drawCountBoost(target, tier);
    const score = base * (0.6 + p.aggression * 0.8) + evidence + (Math.random() - 0.5) * 0.25;
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
