import { randomInt, randomUUID, randomBytes } from 'node:crypto';
import { GameEngine } from './game/engine.js';
import { ChoicePokerEngine } from './game/choicePokerEngine.js';
import { DoubtPokerEngine } from './game/doubtPokerEngine.js';
import { getVariant } from './game/variants/index.js';
import { shuffle } from './game/deck.js';
import { createBotProfile, createBotOrder } from './game/botProfiles.js';
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  deriveBlinds,
  MIN_BLIND_INCREASE_HANDS,
  MAX_BLIND_INCREASE_HANDS,
} from './config.js';

const CHOICE_POKER_PLAYERS = 2;
const DOUBT_POKER_MAX_PLAYERS = 6;

// Choice Poker is heads-up only (exactly 2, non-negotiable); Doubt Poker caps
// lower than the general table max; everything else uses the shared range.
// Shared by bot-room creation and every multiplayer lobby-sizing operation so
// the two modes can never drift out of sync on what's a legal player count.
export function playerCapFor(variantId) {
  if (variantId === 'choice-poker') return { min: CHOICE_POKER_PLAYERS, max: CHOICE_POKER_PLAYERS, fixed: true };
  if (variantId === 'doubt-poker') return { min: MIN_PLAYERS, max: DOUBT_POKER_MAX_PLAYERS, fixed: false };
  return { min: MIN_PLAYERS, max: MAX_PLAYERS, fixed: false };
}

// Custom blinds only apply if both are valid positive integers with BB > SB;
// otherwise the caller falls back to auto-derived blinds in _startGame.
function deriveCustomBlinds(smallBlind, bigBlind) {
  const sb = Math.round(Number(smallBlind));
  const bb = Math.round(Number(bigBlind));
  return Number.isFinite(sb) && Number.isFinite(bb) && sb > 0 && bb > sb ? { sb, bb } : null;
}

function deriveBlindIncreaseHands(blindIncreaseHands) {
  const increaseHands = Math.round(Number(blindIncreaseHands));
  return Number.isFinite(increaseHands) &&
    increaseHands >= MIN_BLIND_INCREASE_HANDS &&
    increaseHands <= MAX_BLIND_INCREASE_HANDS
    ? increaseHands
    : 0;
}

class Room {
  constructor({ code, mode, variantId, maxPlayers, startingChips, hostId, smallBlind, bigBlind, blindIncreaseHands }) {
    this.code = code;
    this.mode = mode; // 'bot' | 'multiplayer'
    this.variantId = variantId;
    this.maxPlayers = maxPlayers;
    this.startingChips = startingChips;
    this.hostId = hostId;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.blindIncreaseHands = blindIncreaseHands;
    this.status = 'lobby'; // lobby | playing | closed
    // playerId -> { id, name, avatar, isBot, socketId, connected, token? }
    // `token` is only ever set for multiplayer human members — it's a
    // server-issued secret proving identity on room:rejoin. `id` alone is
    // NOT sufficient for that: every viewer's game:state already contains
    // every other seat's `id`, so an id-only rejoin would let any player
    // steal another player's seat just by replaying an id they observed.
    this.members = new Map();
    this.engine = null;
    // Which personality template fills each bot slot, shuffled fresh per
    // room — see botProfiles.js's createBotProfile/createBotOrder.
    this.botOrder = createBotOrder();
    // Set of playerIds who've clicked "play again" after the current match's
    // gameover — non-null only while multiplayer is genuinely waiting on a
    // rematch decision (see socket/handlers.js's attachEngineListeners /
    // maybeStartRematch). Bots are pre-added the moment gameover hits, since
    // they have no button to click.
    this.rematchReady = null;
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  _generateCode() {
    let code;
    do {
      code = String(randomInt(0, 10000)).padStart(4, '0');
    } while (this.rooms.has(code));
    return code;
  }

  createBotRoom({ hostPlayer, variantId, numPlayers, startingChips, smallBlind, bigBlind, blindIncreaseHands }) {
    const variant = getVariant(variantId);
    if (!variant) throw new Error('ไม่พบประเภทเกมนี้');
    const cap = playerCapFor(variantId);
    const n = cap.fixed ? cap.max : Math.min(cap.max, Math.max(cap.min, Math.round(numPlayers) || cap.min));
    const chips = Math.max(1, Math.round(startingChips) || 0);
    const customBlinds = deriveCustomBlinds(smallBlind, bigBlind);
    const validIncreaseHands = deriveBlindIncreaseHands(blindIncreaseHands);

    const code = this._generateCode();
    const room = new Room({
      code,
      mode: 'bot',
      variantId,
      maxPlayers: n,
      startingChips: chips,
      hostId: hostPlayer.id,
      smallBlind: customBlinds?.sb,
      bigBlind: customBlinds?.bb,
      blindIncreaseHands: validIncreaseHands,
    });
    room.members.set(hostPlayer.id, { ...hostPlayer, isBot: false, connected: true });
    for (let i = 0; i < n - 1; i++) {
      const bot = createBotProfile(i, room.botOrder);
      const id = `bot-${code}-${i}`;
      room.members.set(id, { id, ...bot, isBot: true, connected: true });
    }

    this._startGame(room);
    this.rooms.set(code, room);
    return room;
  }

  // ---- Multiplayer lobby ---------------------------------------------------

  createLobbyRoom({ hostPlayer, variantId, maxPlayers, startingChips, smallBlind, bigBlind, blindIncreaseHands }) {
    const variant = getVariant(variantId);
    if (!variant) throw new Error('ไม่พบประเภทเกมนี้');
    const cap = playerCapFor(variantId);
    const n = cap.fixed ? cap.max : Math.min(cap.max, Math.max(cap.min, Math.round(maxPlayers) || cap.min));
    const chips = Math.max(1, Math.round(startingChips) || 0);
    const customBlinds = deriveCustomBlinds(smallBlind, bigBlind);
    const validIncreaseHands = deriveBlindIncreaseHands(blindIncreaseHands);

    const code = this._generateCode();
    const playerId = randomUUID();
    const token = randomBytes(16).toString('hex');
    const room = new Room({
      code,
      mode: 'multiplayer',
      variantId,
      maxPlayers: n,
      startingChips: chips,
      hostId: playerId,
      smallBlind: customBlinds?.sb,
      bigBlind: customBlinds?.bb,
      blindIncreaseHands: validIncreaseHands,
    });
    room.members.set(playerId, {
      id: playerId,
      name: hostPlayer.name,
      avatar: hostPlayer.avatar,
      isBot: false,
      connected: true,
      token,
    });
    this.rooms.set(code, room);
    return { code, playerId, token };
  }

  joinRoom(code, player) {
    const room = this.rooms.get(code);
    if (!room || room.mode !== 'multiplayer') throw new Error('ไม่พบห้องนี้');
    if (room.status !== 'lobby') throw new Error('เกมเริ่มไปแล้ว เข้าร่วมไม่ได้');
    if (room.members.size >= room.maxPlayers) throw new Error('ห้องเต็มแล้ว');

    const playerId = randomUUID();
    const token = randomBytes(16).toString('hex');
    room.members.set(playerId, {
      id: playerId,
      name: player.name,
      avatar: player.avatar,
      isBot: false,
      connected: true,
      token,
    });
    return { code, playerId, token };
  }

  _requireHostLobbyRoom(code, hostId) {
    const room = this.rooms.get(code);
    if (!room || room.mode !== 'multiplayer') throw new Error('ไม่พบห้องนี้');
    if (room.status !== 'lobby') throw new Error('เกมเริ่มไปแล้ว');
    if (room.hostId !== hostId) throw new Error('เฉพาะเจ้าของห้องเท่านั้นที่ทำรายการนี้ได้');
    return room;
  }

  addBotToLobby(code, hostId) {
    const room = this._requireHostLobbyRoom(code, hostId);
    if (room.members.size >= room.maxPlayers) throw new Error('ห้องเต็มแล้ว');
    const botIndex = [...room.members.values()].filter((m) => m.isBot).length;
    const bot = createBotProfile(botIndex, room.botOrder);
    const id = `bot-${code}-${botIndex}`;
    room.members.set(id, { id, ...bot, isBot: true, connected: true });
    return room;
  }

  updateLobbyConfig(code, hostId, { maxPlayers }) {
    const room = this._requireHostLobbyRoom(code, hostId);
    const cap = playerCapFor(room.variantId);
    if (cap.fixed) throw new Error('เกมนี้กำหนดจำนวนผู้เล่นตายตัว แก้ไม่ได้');
    const n = Math.round(Number(maxPlayers));
    if (!Number.isFinite(n)) throw new Error('จำนวนผู้เล่นไม่ถูกต้อง');
    if (n < Math.max(cap.min, room.members.size)) {
      throw new Error('ตั้งจำนวนผู้เล่นน้อยกว่าคนที่อยู่ในห้องตอนนี้ไม่ได้');
    }
    if (n > cap.max) throw new Error(`จำนวนผู้เล่นสูงสุดคือ ${cap.max}`);
    room.maxPlayers = n;
    return room;
  }

  // Lobby-phase leave/timeout — reassigns host if needed, closes the room if
  // no humans remain. Distinct from mid-game disconnect handling (see
  // socket/handlers.js's forfeitAndContinue), which has to deal with an
  // already-running engine and committed chips.
  removeMember(code, playerId) {
    const room = this.rooms.get(code);
    if (!room) return null;
    room.members.delete(playerId);
    const remainingHumans = [...room.members.values()].filter((m) => !m.isBot);
    if (remainingHumans.length === 0) {
      this.closeRoom(code);
      return null;
    }
    if (room.hostId === playerId) room.hostId = remainingHumans[0].id;
    return room;
  }

  // Host-only lobby moderation — removing a bot or a fellow (pre-game) human.
  // Reuses removeMember's host-reassignment/room-close logic; the host can
  // never be its own target here since _requireHostLobbyRoom already proved
  // hostId is a member and we explicitly reject targetId === hostId below.
  kickMember(code, hostId, targetId) {
    const room = this._requireHostLobbyRoom(code, hostId);
    if (targetId === hostId) throw new Error('ไม่สามารถเตะตัวเองออกจากห้องได้');
    if (!room.members.has(targetId)) throw new Error('ไม่พบผู้เล่นนี้ในห้อง');
    return this.removeMember(code, targetId);
  }

  // Shared by startLobbyGame and startRematch — a variant's required player
  // count doesn't change depending on whether this is the first match or a
  // rematch into the same room.
  _requirePlayerCount(room) {
    const cap = playerCapFor(room.variantId);
    const n = room.members.size;
    if (cap.fixed ? n !== cap.max : n < cap.min) {
      throw new Error(cap.fixed ? `เกมนี้ต้องมีผู้เล่น ${cap.max} คนพอดี` : `ต้องมีผู้เล่นอย่างน้อย ${cap.min} คน`);
    }
  }

  startLobbyGame(code, hostId) {
    const room = this._requireHostLobbyRoom(code, hostId);
    this._requirePlayerCount(room);
    this._startGame(room);
    return room;
  }

  // Restarts a fresh match in an existing multiplayer room once everyone has
  // readied up after the previous match's gameover — same room config
  // (variant/startingChips/blinds), freshly re-shuffled seats, exactly like
  // the original lobby-triggered startLobbyGame. The old engine's watchdog
  // interval must be torn down before dropping the reference, or it leaks a
  // setInterval that fires forever.
  startRematch(code) {
    const room = this.rooms.get(code);
    if (!room || room.mode !== 'multiplayer') throw new Error('ไม่พบห้องนี้');
    this._requirePlayerCount(room);
    room.engine?.destroy();
    this._startGame(room);
    return room;
  }

  _startGame(room) {
    const seatOrder = shuffle([...room.members.values()]);
    const players = seatOrder.map((m) => ({
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      isBot: m.isBot,
      personality: m.personality,
      chips: room.startingChips,
    }));

    if (room.variantId === 'choice-poker') {
      room.engine = new ChoicePokerEngine({ players });
      room.status = 'playing';
      return;
    }

    const { smallBlind, bigBlind } =
      room.smallBlind && room.bigBlind
        ? { smallBlind: room.smallBlind, bigBlind: room.bigBlind }
        : deriveBlinds(room.startingChips);

    if (room.variantId === 'doubt-poker') {
      room.engine = new DoubtPokerEngine({ players, smallBlind, bigBlind });
      room.status = 'playing';
      return;
    }

    const variant = getVariant(room.variantId);
    room.engine = new GameEngine({ variant, players, smallBlind, bigBlind, blindIncreaseHands: room.blindIncreaseHands });
    room.status = 'playing';
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  closeRoom(code) {
    const room = this.rooms.get(code);
    if (room?.engine) room.engine.destroy();
    this.rooms.delete(code);
  }
}
