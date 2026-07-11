import { estimateEquity } from './equity.js';
import { BOT_PERSONALITIES } from './botProfiles.js';

function callAction() {
  return { action: 'call' };
}

// Sizes the bet/raise as a fraction of the pot instead of interpolating
// across the full min-raise..all-in range. The old range-based interpolation
// scaled off the *stack*, so on a deep table even a merely-decent hand could
// jump straight to a huge fraction of everyone's chips in one bet — real
// players size off the pot (and, preflop, off the blinds), staking a little
// to build a hand and a lot only when actually committing. Pegging to
// `referencePot` reproduces that: it's small preflop (just the blinds) so
// opens land around 2-3x the big blind, and it grows street over street as
// chips go in, so continued value bets naturally ramp up ("ค่อยๆเพิ่มเพื่อไถตัง")
// without any extra street-aware logic.
function raiseOrBet(seat, currentBet, bigBlind, getRaiseBounds, equity, personality, potNow, toCall, wantsToBluff) {
  const bounds = getRaiseBounds(seat.seatIndex);
  if (bounds.max <= currentBet) return callAction();

  const referencePot = Math.max(potNow + Math.max(0, toCall), bigBlind * 2);

  let fraction;
  if (wantsToBluff) {
    // Bluffs lean a bit bigger than value bets for real fold equity, per the
    // "ถ้าจะหลอกค่อยลงไปเยอะหน่อย" ask — but still pot-relative, not stack-relative.
    fraction = 0.55 + personality.aggression * 0.35 + Math.random() * 0.35;
  } else {
    const strength = Math.min(1, Math.max(0, (equity - 0.45) * 1.8));
    fraction = 0.3 + strength * 0.55 + personality.aggression * 0.15;
  }
  fraction *= 0.85 + Math.random() * 0.3;
  fraction = Math.max(0.25, Math.min(1.3, fraction));

  let target = Math.round(currentBet + referencePot * fraction);
  target = Math.min(bounds.max, Math.max(bounds.min, target));

  // Avoid leaving an awkwardly small stack behind — just shove instead.
  if (bounds.max - target < bigBlind * 2) target = bounds.max;

  // Push/fold territory: once truly short, a pot-fraction bet already lands
  // near all-in, so just make it a real shove instead of an oddly specific
  // number just short of the stack.
  const stackTotal = seat.chips + seat.committedStreet;
  if (stackTotal <= bigBlind * 15 && target > stackTotal * 0.6) target = bounds.max;

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
  const potNow = seats.reduce((sum, s) => sum + s.committedTotal, 0);

  let equity = estimateEquity({ holeCards: seat.holeCards, board, numOpponents, variant });

  if (p.mistakeRate && Math.random() < p.mistakeRate) {
    equity = Math.min(1, Math.max(0, equity + (Math.random() - 0.5) * 0.5));
  }
  equity = Math.min(1, Math.max(0, equity + (Math.random() - 0.5) * 0.08));

  const wantsToBluff = Math.random() < p.bluffFreq;

  if (toCall <= 0) {
    const betThreshold = 0.58 - p.aggression * 0.16;
    if (equity > betThreshold || wantsToBluff) {
      return raiseOrBet(seat, currentBet, bigBlind, getRaiseBounds, equity, p, potNow, toCall, wantsToBluff);
    }
    return { action: 'check' };
  }

  const potTotal = potNow + toCall;
  const potOdds = toCall / potTotal;
  const continueThreshold = potOdds * (1.25 - p.looseness * 0.55);

  if (equity < continueThreshold && !wantsToBluff) {
    if (toCall >= seat.chips && equity > 0.32 + (1 - p.looseness) * 0.18) return callAction();
    return { action: 'fold' };
  }

  const raiseThreshold = 0.72 - p.aggression * 0.18;
  if ((equity > raiseThreshold || wantsToBluff) && Math.random() < 0.35 + p.aggression * 0.45) {
    return raiseOrBet(seat, currentBet, bigBlind, getRaiseBounds, equity, p, potNow, toCall, wantsToBluff);
  }

  return callAction();
}
