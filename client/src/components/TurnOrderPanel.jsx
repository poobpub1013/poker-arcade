import { TH } from '../i18n/th.js';

// Shown for action-oriented phases where knowing "who's up" actually matters
// (Hold'em/PLO's single 'betting' phase across streets; Doubt Poker's draw/
// betting/doubt phases). Draw has no single current actor — everyone decides
// simultaneously on their own clock — so there we mark drawn-vs-still-
// deciding via `hasDrawn` instead of highlighting one seat.
export default function TurnOrderPanel({ order, seats, phase, currentActorSeatId }) {
  if (!order || order.length < 2) return null;
  return (
    <div className="turn-order-panel">
      <span className="turn-order-panel__label">{TH.table.turnOrderLabel}</span>
      <div className="turn-order-panel__list">
        {order.map((id) => {
          const seat = seats.find((s) => s.id === id);
          if (!seat) return null;
          const isCurrent = phase !== 'draw' && id === currentActorSeatId;
          const isDone = phase === 'draw' && seat.hasDrawn;
          return (
            <span
              key={id}
              className={`turn-order-panel__item${isCurrent ? ' turn-order-panel__item--current' : ''}${isDone ? ' turn-order-panel__item--done' : ''}`}
            >
              {seat.name}
              {isDone ? ' ✓' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
