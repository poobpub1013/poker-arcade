import pokersolverPkg from 'pokersolver';

const { Hand } = pokersolverPkg;

function combinations(arr, k) {
  const results = [];
  const combo = [];
  function backtrack(start) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      backtrack(i + 1);
      combo.pop();
    }
  }
  backtrack(0);
  return results;
}

// Evaluate the best possible hand for a player given their hole cards and the
// board, respecting the variant's rule on how many hole cards must be used
// (e.g. Omaha requires exactly 2). Returns a pokersolver Hand plus metadata.
export function evaluateHand(holeCards, board, variant) {
  const exactly = variant.holeCardsUsed?.exactly ?? null;

  if (exactly == null) {
    const hand = Hand.solve([...holeCards, ...board]);
    return toResult(hand);
  }

  const holeCombos = combinations(holeCards, exactly);
  const boardCombos = combinations(board, 5 - exactly);
  const candidates = [];
  for (const hc of holeCombos) {
    for (const bc of boardCombos) {
      candidates.push(Hand.solve([...hc, ...bc]));
    }
  }
  const best = Hand.winners(candidates)[0];
  return toResult(best);
}

function toResult(hand) {
  // pokersolver has no distinct "Royal Flush" rank — it's just the highest
  // Straight Flush — but its `descr` text does call it out, so upgrade the
  // display name to match the ranking we teach players (see HowToPlay).
  const isRoyal = hand.name === 'Straight Flush' && /royal/i.test(hand.descr);
  return {
    hand,
    name: isRoyal ? 'Royal Flush' : hand.name,
    description: hand.descr,
    bestFive: hand.cards.map((c) => c.value + c.suit),
  };
}

// Given a map of playerId -> evaluation result (from evaluateHand) and the
// list of player ids eligible for a particular pot, return the winning ids
// (more than one means a split pot).
export function determineWinners(resultsById, eligiblePlayerIds) {
  const candidateHands = eligiblePlayerIds.map((id) => resultsById.get(id).hand);
  const winningHands = Hand.winners(candidateHands);
  return eligiblePlayerIds.filter((id) => winningHands.includes(resultsById.get(id).hand));
}
