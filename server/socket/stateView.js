// Produces a per-viewer filtered copy of the engine's full state so hole
// cards of other players are never sent to a client before they must be
// revealed. This is the only thing standing between "server-authoritative"
// and "trusting the client" — keep all hiding logic here, not in components.
export function buildStateView(fullState, viewerId) {
  const isRealShowdown = fullState.lastResult?.type === 'showdown';
  const seats = fullState.seats.map((seat) => {
    const isViewer = seat.id === viewerId;
    const reveal = isViewer || (isRealShowdown && !seat.folded);
    return {
      ...seat,
      holeCards: reveal ? seat.holeCards : seat.holeCards.map(() => null),
    };
  });
  return { ...fullState, seats, you: viewerId };
}
