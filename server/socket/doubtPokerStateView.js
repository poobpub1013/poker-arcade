// Doubt Poker's visibility rule: a hand stays completely hidden unless it
// has been revealed — either because someone paid to Doubt it (truthfully
// or as a caught lie, either way the cards flip up permanently) or because
// the hand has reached the final showdown, where every remaining hand is
// shown for the record. The one-time draw exchange is never shown to
// anyone but the viewer's own seat.
export function buildDoubtPokerStateView(fullState, viewerId) {
  const isRealShowdown = fullState.lastResult?.type === 'showdown';
  const seats = fullState.seats.map((seat) => {
    const isViewer = seat.id === viewerId;
    const reveal = isViewer || seat.revealed || isRealShowdown;
    return {
      ...seat,
      holeCards: reveal ? seat.holeCards : seat.holeCards.map(() => null),
    };
  });
  return { ...fullState, seats, you: viewerId };
}
