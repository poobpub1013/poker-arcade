export const ACTION_TIMEOUT_MS = 35000;
export const BOT_MIN_DELAY_MS = 2900;
export const BOT_MAX_DELAY_MS = 4100;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;
export const DEFAULT_STARTING_CHIPS = 1000;

// Big blind is derived as startingChips / 100, clamped to a sane range,
// so tables with different buy-ins still play ~100 big blinds deep.
export function deriveBlinds(startingChips) {
  const bb = Math.max(10, Math.round(startingChips / 100 / 10) * 10);
  const sb = Math.max(5, Math.round(bb / 2 / 5) * 5);
  return { smallBlind: sb, bigBlind: bb };
}

export const DEFAULT_BLIND_INCREASE_HANDS = 10;
export const MIN_BLIND_INCREASE_HANDS = 5;
export const MAX_BLIND_INCREASE_HANDS = 50;

function roundToNiceChip(value) {
  const step = value < 100 ? 5 : value < 1000 ? 25 : value < 10000 ? 100 : 500;
  return Math.max(step, Math.round(value / step) * step);
}

// Tournament-style escalation: roughly +50% per level, rounded to chip
// denominations that stay readable (5s, then 25s, 100s, 500s as stacks grow).
export function nextBlindLevel(smallBlind, bigBlind) {
  const bb = roundToNiceChip(bigBlind * 1.5);
  const sb = Math.min(roundToNiceChip(bb / 2), bb - 1);
  return { smallBlind: Math.max(5, sb), bigBlind: Math.max(10, bb) };
}
