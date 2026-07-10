import pokersolverPkg from 'pokersolver';

const { Hand, FiveOfAKind, StraightFlush, FourOfAKind, FullHouse, Flush, Straight, ThreeOfAKind, TwoPair, OnePair, HighCard } =
  pokersolverPkg;

// pokersolver ships a built-in 'joker' ruleset, but it's tuned for a specific
// video-poker paytable: it drops One Pair entirely (a real pair evaluates as
// High Card!) and splits Royal Flush into separate "natural" vs "wild"
// classes ranked on either side of Five of a Kind. Neither matches what
// Choice Poker needs (standard hand rankings, one wild joker, Five of a Kind
// simply ranks above Straight Flush) — so this builds a plain game
// descriptor object instead. Hand.solve() accepts either a ruleset name
// string or an already-shaped object, so this doesn't need pokersolver's
// (private, unexported) game-registration mechanism.
const CHOICE_POKER_GAME = {
  descr: 'choice-poker',
  cardsInHand: 5,
  handValues: [FiveOfAKind, StraightFlush, FourOfAKind, FullHouse, Flush, Straight, ThreeOfAKind, TwoPair, OnePair, HighCard],
  wildValue: 'O',
  wildStatus: 1,
  wheelStatus: 0,
  sfQualify: 5,
  lowestQualified: null,
  noKickers: false,
};

export function evaluateChoiceHand(cards) {
  const hand = Hand.solve(cards, CHOICE_POKER_GAME);
  return { hand, name: hand.name, description: hand.descr };
}

// hand.compare(other) is negative when `hand` is the stronger of the two
// (confirmed empirically against the standard evaluator earlier in this
// project — 'compare' only depends on .rank/.cards, not the ruleset).
// Returns 'a' | 'b' | 'tie'.
export function compareByDirection(resultA, resultB, direction) {
  const cmp = resultA.hand.compare(resultB.hand);
  if (cmp === 0) return 'tie';
  const aIsStronger = cmp < 0;
  if (direction === 'stronger') return aIsStronger ? 'a' : 'b';
  return aIsStronger ? 'b' : 'a';
}
