import { estimateEquity } from './equity.js';
import { BOT_PERSONALITIES } from './botProfiles.js';

function callAction() {
  return { action: 'call' };
}

function raiseOrBet(seat, currentBet, bigBlind, getRaiseBounds, equity, personality) {
  const bounds = getRaiseBounds(seat.seatIndex);
  if (bounds.max <= currentBet) return callAction();

  const aggression = personality.aggression;
  const range = bounds.max - bounds.min;
  const sizeFactor = Math.min(1, Math.max(0.15, (equity - 0.3) * 1.2)) * (0.45 + aggression * 0.55);
  let target = Math.round(bounds.min + range * Math.min(1, sizeFactor));
  target = Math.min(bounds.max, Math.max(bounds.min, target));

  // Avoid leaving an awkwardly small stack behind — just shove instead.
  if (bounds.max - target < bigBlind * 2) target = bounds.max;

  const action = currentBet === 0 ? 'bet' : 'raise';
  return { action, amount: target };
}

// Estimates real winning chances via Monte Carlo rollout (see equity.js) —
// this correctly values drawing hands, not just the current made hand — then
// layers a per-bot personality on top so the table doesn't play like one
// robotic decision-maker wearing different name tags. Randomness (equity
// noise, occasional bluffs, an occasional "mistake" for novice-type bots)
// keeps it from being fully predictable/exploitable.
export function decideBotAction({ seat, seats, board, currentBet, variant, bigBlind, getRaiseBounds, personality }) {
  const p = personality || BOT_PERSONALITIES.sharp;
  const toCall = currentBet - seat.committedStreet;
  const numOpponents = seats.filter((s) => s.dealtIn && !s.folded && s.seatIndex !== seat.seatIndex).length;

  let equity = estimateEquity({ holeCards: seat.holeCards, board, numOpponents, variant });

  if (p.mistakeRate && Math.random() < p.mistakeRate) {
    equity = Math.min(1, Math.max(0, equity + (Math.random() - 0.5) * 0.5));
  }
  equity = Math.min(1, Math.max(0, equity + (Math.random() - 0.5) * 0.08));

  const wantsToBluff = Math.random() < p.bluffFreq;

  if (toCall <= 0) {
    const betThreshold = 0.58 - p.aggression * 0.16;
    if (equity > betThreshold || wantsToBluff) {
      return raiseOrBet(seat, currentBet, bigBlind, getRaiseBounds, equity, p);
    }
    return { action: 'check' };
  }

  const potTotal = seats.reduce((sum, s) => sum + s.committedTotal, 0) + toCall;
  const potOdds = toCall / potTotal;
  const continueThreshold = potOdds * (1.25 - p.looseness * 0.55);

  if (equity < continueThreshold && !wantsToBluff) {
    if (toCall >= seat.chips && equity > 0.32 + (1 - p.looseness) * 0.18) return callAction();
    return { action: 'fold' };
  }

  const raiseThreshold = 0.72 - p.aggression * 0.18;
  if ((equity > raiseThreshold || wantsToBluff) && Math.random() < 0.35 + p.aggression * 0.45) {
    return raiseOrBet(seat, currentBet, bigBlind, getRaiseBounds, equity, p);
  }

  return callAction();
}
