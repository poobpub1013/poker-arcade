// Choice Poker's visibility rule, per the manga: only the cards a player
// drew as replacements are ever shown face-up to the opponent. Cards they
// kept from their original hand stay secret — used for bluffing and
// probability reasoning by both the human player and the bot AI (see
// choicePokerEngine.js's _maskedHandFor, which feeds the bot this exact same
// restricted view) — right up until the actual showdown, where the full
// hand is finally revealed to settle the hand.
export function buildChoicePokerStateView(fullState, viewerId) {
  const isRealShowdown = fullState.lastResult?.type === 'showdown';
  const seats = fullState.seats.map((seat) => {
    const isViewer = seat.id === viewerId;
    if (isViewer || isRealShowdown) {
      return { ...seat };
    }
    if (fullState.phase === 'draw') {
      return { ...seat, hand: seat.hand.map(() => null) };
    }
    const drawnSet = new Set(seat.drawnIndices);
    return { ...seat, hand: seat.hand.map((c, i) => (drawnSet.has(i) ? c : null)) };
  });
  return { ...fullState, seats, you: viewerId };
}
