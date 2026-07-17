import { shuffle } from './deck.js';

// Each personality nudges the bot AI's thresholds/sizing/bluff rate so the
// table doesn't play like one bot wearing different name tags. Traits are
// 0..1: aggression (how light a hand it bets/raises with, and how big),
// looseness (how much worse than "correct" pot odds it's willing to continue
// with), bluffFreq (chance it fires regardless of its actual equity).
// pace multiplies think time (engines' bot delay): <1 snaps decisions, >1
// hesitates — timing is a personality tell just like sizing. fakeTank is the
// chance to stall on an easy spot so a long think stops being a reliable
// "big decision" signal from that bot.
export const BOT_PERSONALITIES = {
  calm: { aggression: 0.35, bluffFreq: 0.08, looseness: 0.42, pace: 1.15 },
  aggressive: { aggression: 0.85, bluffFreq: 0.22, looseness: 0.62, pace: 0.8 },
  sharp: { aggression: 0.55, bluffFreq: 0.16, looseness: 0.5, pace: 0.68 },
  novice: { aggression: 0.5, bluffFreq: 0.12, looseness: 0.7, mistakeRate: 0.18, pace: 1.45 },
  gambler: { aggression: 0.7, bluffFreq: 0.28, looseness: 0.8, pace: 0.85 },
  careful: { aggression: 0.3, bluffFreq: 0.05, looseness: 0.3, pace: 1.3 },
  rock: { aggression: 0.25, bluffFreq: 0.03, looseness: 0.2, pace: 1.05 },
  trickster: { aggression: 0.6, bluffFreq: 0.35, looseness: 0.55, pace: 1.0, fakeTank: 0.22 },
  brawler: { aggression: 0.9, bluffFreq: 0.18, looseness: 0.65, pace: 0.75 },
  station: { aggression: 0.2, bluffFreq: 0.04, looseness: 0.75, pace: 0.9 },
};

const BOT_TEMPLATES = [
  { name: 'บอทใจเย็น', personality: BOT_PERSONALITIES.calm },
  { name: 'บอทดุดัน', personality: BOT_PERSONALITIES.aggressive },
  { name: 'บอทเซียน', personality: BOT_PERSONALITIES.sharp },
  { name: 'บอทมือใหม่', personality: BOT_PERSONALITIES.novice },
  { name: 'บอทเสี่ยงดวง', personality: BOT_PERSONALITIES.gambler },
  { name: 'บอทรอบคอบ', personality: BOT_PERSONALITIES.careful },
  { name: 'บอทหินผา', personality: BOT_PERSONALITIES.rock },
  { name: 'บอทจอมหลอก', personality: BOT_PERSONALITIES.trickster },
  { name: 'บอทสายบู๊', personality: BOT_PERSONALITIES.brawler },
  { name: 'บอทสายรอ', personality: BOT_PERSONALITIES.station },
];

// A fresh shuffle of which template fills each slot — generated once per
// room (see rooms.js's Room constructor) so which cast of personalities
// shows up, not just their seating, varies game to game instead of always
// being the same fixed first N-1 templates in index order.
export function createBotOrder() {
  return shuffle([...Array(BOT_TEMPLATES.length).keys()]);
}

// `count` is how many bots already exist in this room (0 for the first);
// `order` is that room's createBotOrder() result, so repeated calls for the
// same room keep drawing distinct templates (no repeats) until it wraps.
export function createBotProfile(count, order) {
  const templateIndex = order[count % order.length];
  const template = BOT_TEMPLATES[templateIndex];
  const suffix = count >= order.length ? ` ${Math.floor(count / order.length) + 1}` : '';
  return { name: template.name + suffix, avatar: null, personality: template.personality };
}
