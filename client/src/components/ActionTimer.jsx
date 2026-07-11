import { TH } from '../i18n/th.js';

const WARNING_MS = 10000;

// Persistent countdown for the player's own timed action (draw/bet/announce/
// doubt/choice), shown at the top of the action bar for the whole duration
// of the turn instead of only popping up in the final 10 seconds. Styled
// like a tournament shot clock (a small "เวลา" label over big digits in a
// rounded box) rather than a thin progress bar — a bar was too easy to not
// notice at a glance, and the label makes it clear the number is a countdown
// of remaining seconds.
export default function ActionTimer({ timeLeftMs, totalTimeMs }) {
  if (timeLeftMs === null || timeLeftMs === undefined || !totalTimeMs) return null;
  const seconds = Math.max(0, Math.ceil(timeLeftMs / 1000));
  const isWarning = timeLeftMs <= WARNING_MS;

  return (
    <div
      className={`action-timer${isWarning ? ' action-timer--warning' : ''}`}
      aria-label={`${TH.table.timeLabel} ${seconds}s`}
    >
      <span className="action-timer__label">{TH.table.timeLabel}</span>
      <span className="action-timer__value">{seconds}</span>
    </div>
  );
}
