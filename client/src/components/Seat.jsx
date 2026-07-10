import Card from './Card.jsx';
import DefaultAvatar from './DefaultAvatar.jsx';
import { TH } from '../i18n/th.js';

export default function Seat({ seat, style, isActor, isYou, timeLeftMs, totalTimeMs, warningMs = 0, extraBadge }) {
  if (!seat) return null;
  const holeCards = seat.holeCards || [];
  const isWideHand = isYou && holeCards.length > 2;
  const showTimer = isActor && typeof timeLeftMs === 'number' && totalTimeMs > 0;
  const timerPct = showTimer ? Math.max(0, Math.min(100, (timeLeftMs / totalTimeMs) * 100)) : 0;
  const isWarning = showTimer && timeLeftMs <= warningMs;

  const classNames = [
    'seat',
    isActor && 'seat--active',
    isWarning && 'seat--warning',
    seat.folded && 'seat--folded',
    seat.eliminated && 'seat--eliminated',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames} style={style}>
      <div className={`seat__cards${isYou ? ' seat__cards--you' : ''}${isWideHand ? ' seat__cards--wide' : ''}`}>
        {holeCards.map((c, i) => (
          <Card key={i} code={c} size={isYou ? 'xl' : 'sm'} />
        ))}
      </div>

      <div className="seat__avatar">
        {seat.avatar ? <img src={seat.avatar} alt={seat.name} /> : <DefaultAvatar seed={seat.name} size={56} />}
        {showTimer && (
          <div className={`seat__timer-bar${isWarning ? ' seat__timer-bar--warning' : ''}`}>
            <div className="seat__timer-bar__fill" style={{ width: `${timerPct}%` }} />
          </div>
        )}
      </div>

      <div className="seat__info">
        <span className="seat__name">{seat.name}</span>
        <span>{seat.chips.toLocaleString()}</span>
      </div>

      <div className="seat__badges">
        {seat.isDealer && <span className="badge badge--dealer">{TH.table.dealer}</span>}
        {seat.isSB && <span className="badge">{TH.table.smallBlind}</span>}
        {seat.isBB && <span className="badge">{TH.table.bigBlind}</span>}
        {seat.allIn && <span className="badge badge--allin">ALL-IN</span>}
        {extraBadge}
      </div>

      {seat.committedStreet > 0 && <div className="seat__bet">{seat.committedStreet.toLocaleString()}</div>}
      {seat.folded && <div className="seat__folded-label">{TH.table.folded}</div>}
      {seat.eliminated && <div className="seat__folded-label">{TH.table.eliminated}</div>}
    </div>
  );
}
