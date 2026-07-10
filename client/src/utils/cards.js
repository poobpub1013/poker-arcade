const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

// Sorts a hand low-to-high for display while keeping each card's original
// index attached — callers that need to map a click back to a server-side
// position (e.g. a discard picker) must use `.index`, not array position.
export function sortedHand(cards) {
  return cards
    .map((code, index) => ({ code, index }))
    .sort((a, b) => RANK_ORDER.indexOf(a.code[0]) - RANK_ORDER.indexOf(b.code[0]));
}
