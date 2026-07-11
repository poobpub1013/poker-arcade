import { estimateChoicePokerEquity } from './choicePokerEquity.js';
import { BOT_PERSONALITIES } from './botProfiles.js';

const RANK_ORDER = '23456789TJQKA';

// Swapping every non-joker card telegraphs exactly what happened and reads
// as "I had nothing" — real draw play (and the manga) never dumps the whole
// hand. Capping it forces the bot to always keep something back.
const MAX_DISCARD = 3;

function rankValue(card) {
  if (card[0] === 'O') return -1; // joker — never discard it
  return RANK_ORDER.indexOf(card[0]);
}

function countBy(cards, keyFn) {
  const counts = new Map();
  for (const c of cards) {
    const key = keyFn(c);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Always maxing out the discard reads as mechanical (every no-pair hand
// dumps exactly 3, every leftover kicker gets tossed) — real players
// sometimes hang onto one extra card as a hedge against a bad redraw.
// Cautious personalities do this more; aggressive ones commit to the full
// discard more consistently.
function holdBackChance(p) {
  return Math.min(0.6, Math.max(0.15, 0.45 - (p.aggression - 0.5) * 0.4));
}

// Which of this 5-card hand to discard, capped at MAX_DISCARD. No opponent
// info needed here — this is a standalone decision made before either hand
// is revealed. The joker is always kept (strictly better than discarding
// it, no matter what's built around it).
//
// A made pair/trips/flush draw is always worth building on — keep it,
// discard the rest (a lone pair with no joker already discards exactly
// MAX_DISCARD, so the cap never has to trim that case further).
//
// Without one, this is a "junk" hand and there's a real choice to make: the
// betting war's winner picks whether normal or reversed hand rankings apply,
// so a hand built to be reliably *weak* (low, unpaired, keeps the choice of
// "weaker" live) is just as valid a plan as chasing strength. Which way a
// given hand leans is nudged by what's already there — mostly-low cards make
// "weak" the more natural read, mostly-high cards make "strong" more
// natural — plus personality-flavored randomness (aggressive personalities
// lean toward chasing strength; careful ones lean toward playing it weak-safe)
// so it isn't a fixed rule hand after hand.
export function decideChoicePokerDraw(hand, personality) {
  const p = personality || BOT_PERSONALITIES.sharp;
  const jokerIndex = hand.findIndex((c) => c[0] === 'O');
  const nonJokerIndices = hand.map((_, i) => i).filter((i) => i !== jokerIndex);
  const nonJokerCards = nonJokerIndices.map((i) => hand[i]);
  const rankCounts = countBy(nonJokerCards, (c) => c[0]);
  const suitCounts = countBy(nonJokerCards, (c) => c[1]);

  const pairedRanks = new Set([...rankCounts.entries()].filter(([, n]) => n >= 2).map(([r]) => r));
  const bestSuit = [...suitCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const flushDraw = bestSuit && bestSuit[1] >= 4;

  // Trips or better already — a pair plus the joker makes trips on its own —
  // so stand pat rather than break up a strong hand.
  const hasTripsOrBetter = [...rankCounts.values()].some((n) => n >= 3) || (jokerIndex >= 0 && pairedRanks.size > 0);
  if (hasTripsOrBetter) return [];

  if (pairedRanks.size > 0 || flushDraw) {
    const discard = nonJokerIndices
      .filter((i) => {
        const card = hand[i];
        const isPaired = pairedRanks.has(card[0]);
        const isFlushCard = flushDraw && card[1] === bestSuit[0];
        return !isPaired && !isFlushCard;
      })
      .slice(0, MAX_DISCARD);

    if (discard.length > 1 && Math.random() < holdBackChance(p)) {
      // Hedge: keep the best of the leftover kickers instead of ditching it too.
      const bestKicker = discard.reduce((best, i) => (rankValue(hand[i]) > rankValue(hand[best]) ? i : best));
      return discard.filter((i) => i !== bestKicker);
    }
    return discard;
  }

  const lowCount = nonJokerIndices.filter((i) => rankValue(hand[i]) <= 5).length; // 2..7
  const highCount = nonJokerIndices.filter((i) => rankValue(hand[i]) >= 8).length; // T..A
  const lowLean = nonJokerIndices.length > 0 ? (lowCount - highCount) / nonJokerIndices.length : 0; // -1..1
  const weakChance = Math.min(0.9, Math.max(0.1, 0.5 + lowLean * 0.35 - (p.aggression - 0.5) * 0.3));
  const goWeak = Math.random() < weakChance;

  const sortedAscending = [...nonJokerIndices].sort((a, b) => rankValue(hand[a]) - rankValue(hand[b]));
  const maxPossible = Math.min(MAX_DISCARD, sortedAscending.length);
  const discardCount = maxPossible > 1 && Math.random() < holdBackChance(p) ? maxPossible - 1 : maxPossible;
  return goWeak
    ? sortedAscending.slice(sortedAscending.length - discardCount) // ditch the highest cards, keep it low
    : sortedAscending.slice(0, discardCount); // ditch the lowest cards, keep chasing strength
}

// A bot's preferred direction if it wins the bid — whichever of
// Stronger/Weaker wins more often against the opponent's only-partially-known
// hand (their kept cards are hidden — same restricted view a human opponent
// gets, see choicePokerEngine.js's _maskedHandFor). Since the opponent's real
// hand isn't known for certain, this is now a genuine probability call, not
// a sure thing — matching the manga's use of the hidden cards for bluffing
// and read-the-opponent play, not a deterministic "always win the choice."
export function decideChoicePokerDirection({ myHand, opponentKnownHand }) {
  const { winRateStronger, winRateWeaker } = estimateChoicePokerEquity({ myHand, opponentKnownHand });
  return winRateStronger >= winRateWeaker ? 'stronger' : 'weaker';
}

// How much of its stack this bot is willing to commit to keep outbidding for
// the choice, scaled by its estimated win rate under whichever direction it
// would pick (see decideChoicePokerDirection) and by personality (aggression
// raises both the ceiling and the opening size; a rock/careful bot backs off
// much sooner than a gambler/brawler, especially with a shaky read).
export function decideChoicePokerBet({
  myHand,
  opponentKnownHand,
  currentBet,
  isOpening,
  myStackTotal,
  opponentStackTotal,
  personality,
  startingChips,
}) {
  const p = personality || BOT_PERSONALITIES.sharp;
  const { winRateStronger, winRateWeaker } = estimateChoicePokerEquity({ myHand, opponentKnownHand });
  const bestWinRate = Math.max(winRateStronger, winRateWeaker);

  let noise = (Math.random() - 0.5) * 0.1;
  if (p.mistakeRate && Math.random() < p.mistakeRate) noise += (Math.random() - 0.5) * 0.3;
  const confidence = Math.min(1, Math.max(0, bestWinRate + noise));
  const strongRead = confidence > 0.55;

  // Push/fold-style short-stack adjustment: staying just as cautious with a
  // near-felted stack as with a full one means the bot never actually
  // commits, bleeding away tiny opens hand after hand instead of going bust
  // in a reasonable number of hands (which forced the human to grind out
  // dozens of trivial hands to finish a match). Below 25% of the starting
  // stack there's little left to protect by playing tight, so willingness
  // ramps sharply toward "just shove" the shorter the stack gets.
  const stackRatio = startingChips > 0 ? myStackTotal / startingChips : 1;
  const shortStackBoost = Math.max(0, 0.25 - stackRatio) * 4; // 0 at 25%+ stack, up to 1 at felted

  const baseFraction = Math.min(1, Math.max(0.05, (confidence - 0.35) * 1.3)) * (0.4 + p.aggression * 0.6);
  const willingnessFraction = Math.min(1, baseFraction + shortStackBoost);
  const ceiling = Math.max(1, Math.round(myStackTotal * willingnessFraction));

  const riskCap = Math.min(myStackTotal, ceiling);

  // Betting beyond whatever the opponent could ever put in is pure wasted
  // risk: the pot is winner-take-all on uneven bets, so once currentBet
  // reaches their whole stack they're *already* fully denied any further
  // raise (forced to stand) no matter how much more gets added on top —
  // that excess only grows what's lost if the read is wrong, with zero
  // extra effect if it's right. Capping every bet at the smaller of "what
  // I'm willing to risk" and "what could ever matter" both keeps a
  // confident bot from torching its own stack chasing a tiny opponent ante,
  // and — since a critically short opponent's whole stack is a small,
  // easily-affordable number for anyone well ahead — still lets the bot
  // close the hand out in a single decisive raise instead of grinding
  // through several small ones as their stack slowly runs out.
  const usefulCap = opponentStackTotal > 0 ? Math.min(riskCap, opponentStackTotal) : riskCap;

  if (isOpening) {
    const openSize = Math.max(1, Math.round(myStackTotal * (0.05 + p.aggression * 0.08 + shortStackBoost * 0.3)));
    // A truly desperate stack (shortStackBoost near 1, which already pushes
    // `ceiling` up toward the full stack) has little left to protect by
    // opening cautiously — blend the open size toward its full risk ceiling
    // as it gets shorter, so it commits to a real push instead of nibbling
    // away at itself one modest open at a time. At shortStackBoost = 0 this
    // is unchanged from the plain self-based open.
    const desperateOpen = Math.round(openSize + shortStackBoost * (riskCap - openSize));
    return { action: 'raise', amount: Math.max(1, Math.min(usefulCap, desperateOpen)) };
  }

  if (currentBet >= myStackTotal || currentBet >= ceiling) {
    // A real stand-or-shove decision. A short stack has little left to lose
    // by taking the coin flip, so it shoves far more readily than a bot
    // still sitting on plenty of reserve chips. "Shoving" still only means
    // putting in as much as the opponent could ever match, not the bot's
    // entire stack, for the same wasted-risk reason as above.
    const shoveChance = Math.min(1, p.aggression * 0.3 + shortStackBoost);
    if ((strongRead || shortStackBoost > 0) && Math.random() < shoveChance) {
      const shoveAmount =
        opponentStackTotal > 0 ? Math.min(myStackTotal, Math.max(currentBet + 1, opponentStackTotal)) : myStackTotal;
      return { action: 'raise', amount: shoveAmount };
    }
    return { action: 'stand' };
  }

  const step = Math.max(1, Math.round((myStackTotal - currentBet) * (0.15 + p.aggression * 0.25 + shortStackBoost * 0.3)));
  const stepTarget = currentBet + step;
  // Same desperation blend as the opening case above, applied to the raise target.
  const desperateTarget = Math.round(stepTarget + shortStackBoost * (riskCap - stepTarget));
  const target = Math.min(usefulCap, Math.max(stepTarget, desperateTarget));
  // Already at or past what's useful to bet here (a low-confidence risk cap,
  // or the opponent's stack already nearly matched) — nothing left worth
  // raising for, so stand instead of throwing an invalid (non-increasing) raise.
  if (target <= currentBet) return { action: 'stand' };
  return { action: 'raise', amount: target };
}
