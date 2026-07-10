// Splits total chip contributions into a main pot and side pots.
// players: [{ id, committedTotal, folded }] where committedTotal is the total
// chips a player has put into the pot across the whole hand.
// Returns: [{ amount, eligiblePlayerIds }] — one entry per distinct
// contribution "layer", ordered from the smallest (main pot) to largest
// (last side pot). A layer is only included if it has money in it and at
// least one non-folded player is eligible to win it.
export function calculatePots(players) {
  const contributors = players.filter((p) => p.committedTotal > 0);
  const levels = [...new Set(contributors.map((p) => p.committedTotal))].sort((a, b) => a - b);

  const pots = [];
  let previousLevel = 0;
  for (const level of levels) {
    const atLevel = contributors.filter((p) => p.committedTotal >= level);
    const amount = (level - previousLevel) * atLevel.length;
    const eligiblePlayerIds = atLevel.filter((p) => !p.folded).map((p) => p.id);
    if (amount > 0 && eligiblePlayerIds.length > 0) {
      pots.push({ amount, eligiblePlayerIds });
    }
    previousLevel = level;
  }
  return pots;
}

// Splits `amount` evenly among `winnerIds`, handing any indivisible remainder
// chip(s) one-at-a-time to the winners closest to the left of the dealer
// button, per standard poker convention. `orderFromDealer` must contain every
// id in `winnerIds` (order defines priority for remainder chips).
export function splitPotAmount(amount, winnerIds, orderFromDealer) {
  const share = Math.floor(amount / winnerIds.length);
  let remainder = amount - share * winnerIds.length;
  const ordered = orderFromDealer.filter((id) => winnerIds.includes(id));
  const result = new Map();
  for (const id of ordered) {
    let payout = share;
    if (remainder > 0) {
      payout += 1;
      remainder -= 1;
    }
    result.set(id, payout);
  }
  return result;
}
