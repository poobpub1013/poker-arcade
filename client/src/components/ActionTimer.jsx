const WARNING_MS = 10000;

// Persistent countdown for the player's own timed action (draw/bet/announce/
// doubt/choice), shown at the top of the action bar for the whole duration
// of the turn instead of only popping up in the final 10 seconds. Styled
// like a tournament shot clock (big digits in a square) rather than a thin
// progress bar — a bar was too easy to not notice at a glance.
export default function ActionTimer({ timeLeftMs, totalTimeMs }) {
  if (timeLeftMs === null || timeLeftMs === undefined || !totalTimeMs) return null;
  const seconds = Math.max(0, Math.ceil(timeLeftMs / 1000));
  const isWarning = timeLeftMs <= WARNING_MS;

  return (
    <div className={`action-timer${isWarning ? ' action-timer--warning' : ''}`} aria-label={`${seconds}s`}>
      {seconds}
    </div>
  );
}
