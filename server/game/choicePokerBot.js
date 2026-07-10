import { estimateChoicePokerEquity } from './choicePokerEquity.js';
import { BOT_PERSONALITIES } from './botProfiles.js';

const RANK_ORDER = '23456789TJQKA';

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

// Which of this 5-card hand to discard. No opponent info needed here — this
// is a standalone "make my own hand as strong as possible" decision, made
// before either hand is revealed. Keeps pairs/trips/quads and flush/straight
// draws; discards the rest. The joker is always kept (it's strictly better
// than discarding it, no matter what's built around it).
export function decideChoicePokerDraw(hand) {
  const jokerIndex = hand.findIndex((c) => c[0] === 'O');
  const rankCounts = countBy(
    hand.filter((_, i) => i !== jokerIndex),
    (c) => c[0]
  );
  const suitCounts = countBy(
    hand.filter((_, i) => i !== jokerIndex),
    (c) => c[1]
  );

  const pairedOrBetterRanks = new Set([...rankCounts.entries()].filter(([, n]) => n >= 2).map(([r]) => r));
  const bestSuit = [...suitCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const flushDraw = bestSuit && bestSuit[1] >= 4;

  const discard = [];
  hand.forEach((card, i) => {
    if (i === jokerIndex) return;
    const isPaired = pairedOrBetterRanks.has(card[0]);
    const isFlushCard = flushDraw && card[1] === bestSuit[0];
    if (!isPaired && !isFlushCard) discard.push(i);
  });

  // Already have a strong made hand (three of a kind or better) — stand pat.
  if ([...rankCounts.values()].some((n) => n >= 3)) return [];

  return discard;
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

  if (isOpening) {
    const openSize = Math.max(1, Math.round(myStackTotal * (0.05 + p.aggression * 0.08 + shortStackBoost * 0.3)));
    return { action: 'raise', amount: Math.min(openSize, myStackTotal) };
  }

  if (currentBet >= myStackTotal || currentBet >= ceiling) {
    // A real stand-or-shove decision. A short stack has little left to lose
    // by taking the coin flip, so it shoves far more readily than a bot
    // still sitting on plenty of reserve chips.
    const shoveChance = Math.min(1, p.aggression * 0.3 + shortStackBoost);
    if ((strongRead || shortStackBoost > 0) && Math.random() < shoveChance) {
      return { action: 'raise', amount: myStackTotal };
    }
    return { action: 'stand' };
  }

  const step = Math.max(1, Math.round((myStackTotal - currentBet) * (0.15 + p.aggression * 0.25 + shortStackBoost * 0.3)));
  const target = Math.min(myStackTotal, currentBet + step);
  return { action: 'raise', amount: target };
}
