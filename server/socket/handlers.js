import { RoomManager, playerCapFor } from '../rooms.js';
import { buildStateView } from './stateView.js';
import { buildChoicePokerStateView } from './choicePokerStateView.js';
import { buildDoubtPokerStateView } from './doubtPokerStateView.js';
import { listVariants } from '../game/variants/index.js';
import { MIN_PLAYERS, MAX_PLAYERS } from '../config.js';

const MAX_NAME_LENGTH = 20;
const MAX_AVATAR_BYTES = 300_000; // dataURL length cap, keeps socket payloads small
// Window to reconnect before a room gives up on a disconnected player.
// Overridable so live verification scripts don't have to sleep the full
// default length.
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS_OVERRIDE) || 20000;
const MAX_CHAT_LENGTH = 200;
const CHAT_RATE_LIMIT_MS = 400;

const roomManager = new RoomManager();

if (process.env.DEBUG_POKER) {
  setInterval(() => {
    for (const [code, room] of roomManager.rooms) {
      if (!room.engine) continue;
      const s = room.engine.getState();
      console.log(
        `${new Date().toISOString()} [heartbeat] room=${code} phase=${s.phase} street=${s.street} actor=${s.currentActorSeatId} pot=${s.pot} paused=${s.paused} humans=${[...room.members.values()].filter((m) => !m.isBot).length}`
      );
    }
  }, 5000);
}

function sanitizeName(name) {
  const trimmed = String(name || '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || 'ผู้เล่น';
}

function sanitizeAvatar(avatar) {
  if (typeof avatar !== 'string') return null;
  if (!avatar.startsWith('data:image/')) return null;
  if (avatar.length > MAX_AVATAR_BYTES) return null;
  return avatar;
}

function buildViewForVariant(room, full, viewerId) {
  if (room.variantId === 'choice-poker') return buildChoicePokerStateView(full, viewerId);
  if (room.variantId === 'doubt-poker') return buildDoubtPokerStateView(full, viewerId);
  return buildStateView(full, viewerId);
}

function sendStateToMember(io, room, member, full, event) {
  if (member.isBot || !member.socketId) return;
  const view = buildViewForVariant(room, full, member.id);
  io.to(member.socketId).emit('game:state', { ...view, event });
  // getLegalActions already self-guards on phase/turn (and, for Choice
  // Poker's simultaneous draw phase, "turn" isn't even a single-actor
  // concept) — trusting its null-vs-object return avoids duplicating that
  // logic here per game type.
  const legal = room.engine.getLegalActions(member.id);
  if (legal) io.to(member.socketId).emit('game:yourTurn', legal);
}

function broadcastState(io, room, event) {
  const full = room.engine.getState();
  if (process.env.DEBUG_POKER) {
    console.log(
      `${new Date().toISOString()} [update] room=${room.code} reason=${event?.reason} action=${event?.action} phase=${full.phase} street=${full.street} actor=${full.currentActorSeatId} pot=${full.pot} paused=${full.paused}`
    );
  }
  for (const member of room.members.values()) {
    sendStateToMember(io, room, member, full, event);
  }
}

// Nothing is hidden pre-game, so a single non-per-viewer broadcast is enough
// (unlike broadcastState, which has to filter hole cards per viewer).
function broadcastLobbyState(io, room) {
  io.to(room.code).emit('lobby:state', {
    code: room.code,
    status: room.status,
    variantId: room.variantId,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    players: [...room.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      isBot: m.isBot,
      connected: m.connected,
    })),
  });
}

// Permanent-disconnect resolution for a mid-game multiplayer seat (grace
// period expired without a reconnect). Removing the member first — before
// counting remaining humans — mirrors bot-mode's only reasonable fallback:
// if that was the last human in the room, there's no one left to keep the
// table running for, so just close it instead of leaving a bots-only table
// running forever.
function forfeitAndContinue(io, room, playerId) {
  room.members.delete(playerId);
  const remainingHumans = [...room.members.values()].filter((m) => !m.isBot);
  if (remainingHumans.length === 0) {
    roomManager.closeRoom(room.code);
    return;
  }
  room.engine.forfeitSeat(playerId);
  room.engine.resume(); // safe no-op if this table was never paused
  broadcastState(io, room, { reason: 'seat-forfeited', playerId });
}

// True only in the window between a match's gameover and the next rematch
// actually starting — a distinct leave path applies there (see
// leaveDuringRematchWait): there's no in-progress hand to forfeit out of,
// so forcing a departing player through forfeitSeat would incorrectly zero
// their chips and mark them "eliminated" from an already-finished match.
function isAwaitingRematch(room) {
  return room.mode === 'multiplayer' && !!room.rematchReady;
}

// Nothing here is per-viewer-sensitive (same as lobby:state), so a single
// broadcast covers everyone.
function broadcastRematchState(io, room) {
  if (!room.rematchReady) return;
  io.to(room.code).emit('game:rematchState', {
    readyIds: [...room.rematchReady],
    players: [...room.members.values()].map((m) => ({ id: m.id, name: m.name, isBot: m.isBot })),
  });
}

// Shared by every place an engine gets (re)wired up to broadcast its state
// (bots:start, room:start, and a rematch restart) — also the single hook
// point for noticing a match just ended, so rematch bookkeeping can't drift
// out of sync with whichever handler happened to start this particular
// engine.
function attachEngineListeners(io, room) {
  room.engine.on('update', (event) => {
    broadcastState(io, room, event);
    if (event?.reason === 'game-over' && room.mode === 'multiplayer') {
      // Bots can't click "ready" — pre-mark them so only humans are ever
      // waited on.
      room.rematchReady = new Set([...room.members.values()].filter((m) => m.isBot).map((m) => m.id));
      broadcastRematchState(io, room);
    }
  });
}

// Post-gameover leave (the "leave room" choice on the rematch prompt, or the
// disconnect-grace-timer expiring during that same window) — a plain
// membership removal, same as leaving a pre-game lobby, since there's no
// hand in flight to forfeit out of.
function leaveDuringRematchWait(io, room, playerId) {
  const updated = roomManager.removeMember(room.code, playerId);
  if (!updated) return; // room closed — no humans left

  updated.rematchReady?.delete(playerId);

  // No join path exists mid-rematch-wait (room:join requires status:'lobby'),
  // so if enough players just left to drop below the variant's minimum, this
  // room can never reach it again — tell whoever's left before closing it
  // out from under them, rather than leaving them stuck on a "waiting for
  // ready" screen that can never resolve.
  const cap = playerCapFor(updated.variantId);
  if (updated.members.size < cap.min) {
    io.to(updated.code).emit('room:closed', { message: 'ผู้เล่นไม่พอสำหรับเริ่มเกมใหม่ ห้องถูกปิด' });
    roomManager.closeRoom(updated.code);
    return;
  }

  broadcastRematchState(io, updated);
  maybeStartRematch(io, updated);
}

// Once every current member (humans who clicked ready + pre-readied bots)
// is accounted for, tear down the finished engine and deal a fresh match
// into the same room. A departing member during the wait is never counted
// against readiness — removeMember already shrinks room.members before this
// runs, so their absence can only ever make "everyone ready" become true
// sooner, never block it.
function maybeStartRematch(io, room) {
  if (!room.rematchReady || room.members.size === 0) return;
  const allReady = [...room.members.keys()].every((id) => room.rematchReady.has(id));
  if (!allReady) return;
  room.rematchReady = null;
  try {
    roomManager.startRematch(room.code);
  } catch {
    // Shouldn't happen — leaveDuringRematchWait already closes the room
    // before membership can drop below the variant minimum — but never
    // crash a socket handler over a state mismatch slipping through.
    roomManager.closeRoom(room.code);
    return;
  }
  attachEngineListeners(io, room);
  room.engine.startNextHand();
}

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const meta = { profile: null, code: null, playerId: socket.id };

    socket.on('variants:list', (cb) => {
      if (typeof cb === 'function') cb(listVariants());
    });

    socket.on('profile:set', ({ name, avatar } = {}) => {
      meta.profile = { name: sanitizeName(name), avatar: sanitizeAvatar(avatar) };
    });

    socket.on('bots:start', ({ variantId, numPlayers, startingChips, smallBlind, bigBlind, blindIncreaseHands } = {}, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        if (!meta.profile) throw new Error('กรุณาตั้งชื่อผู้เล่นก่อนเริ่มเกม');
        const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(numPlayers) || MIN_PLAYERS));
        const chips = Math.max(1, Number(startingChips) || 0);

        const room = roomManager.createBotRoom({
          hostPlayer: { id: meta.playerId, name: meta.profile.name, avatar: meta.profile.avatar },
          variantId,
          numPlayers: n,
          startingChips: chips,
          smallBlind,
          bigBlind,
          blindIncreaseHands,
        });
        meta.code = room.code;
        room.members.get(meta.playerId).socketId = socket.id;
        socket.join(room.code);

        attachEngineListeners(io, room);
        room.engine.startNextHand();

        reply({ ok: true, code: room.code });
      } catch (err) {
        reply({ ok: false, message: err.message });
      }
    });

    // ---- Multiplayer lobby ---------------------------------------------

    socket.on(
      'room:create',
      ({ variantId, maxPlayers, startingChips, smallBlind, bigBlind, blindIncreaseHands } = {}, cb) => {
        const reply = typeof cb === 'function' ? cb : () => {};
        try {
          if (!meta.profile) throw new Error('กรุณาตั้งชื่อผู้เล่นก่อนสร้างห้อง');
          const chips = Math.max(1, Number(startingChips) || 0);
          const { code, playerId, token } = roomManager.createLobbyRoom({
            hostPlayer: { name: meta.profile.name, avatar: meta.profile.avatar },
            variantId,
            maxPlayers,
            startingChips: chips,
            smallBlind,
            bigBlind,
            blindIncreaseHands,
          });
          const room = roomManager.getRoom(code);
          meta.code = code;
          meta.playerId = playerId;
          meta.token = token;
          room.members.get(playerId).socketId = socket.id;
          socket.join(code);

          reply({ ok: true, code, playerId, token });
          broadcastLobbyState(io, room);
        } catch (err) {
          reply({ ok: false, message: err.message });
        }
      }
    );

    socket.on('room:join', ({ code } = {}, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        if (!meta.profile) throw new Error('กรุณาตั้งชื่อผู้เล่นก่อนเข้าร่วมห้อง');
        const trimmedCode = String(code || '').trim();
        const { playerId, token } = roomManager.joinRoom(trimmedCode, {
          name: meta.profile.name,
          avatar: meta.profile.avatar,
        });
        const room = roomManager.getRoom(trimmedCode);
        meta.code = trimmedCode;
        meta.playerId = playerId;
        meta.token = token;
        room.members.get(playerId).socketId = socket.id;
        socket.join(trimmedCode);

        reply({ ok: true, code: trimmedCode, playerId, token });
        broadcastLobbyState(io, room);
      } catch (err) {
        reply({ ok: false, message: err.message });
      }
    });

    socket.on('room:addBot', (cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        const room = roomManager.addBotToLobby(meta.code, meta.playerId);
        reply({ ok: true });
        broadcastLobbyState(io, room);
      } catch (err) {
        reply({ ok: false, message: err.message });
      }
    });

    socket.on('room:updateConfig', ({ maxPlayers } = {}, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        const room = roomManager.updateLobbyConfig(meta.code, meta.playerId, { maxPlayers });
        reply({ ok: true });
        broadcastLobbyState(io, room);
      } catch (err) {
        reply({ ok: false, message: err.message });
      }
    });

    socket.on('room:start', (cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        const room = roomManager.startLobbyGame(meta.code, meta.playerId);
        attachEngineListeners(io, room);
        room.engine.startNextHand();
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, message: err.message });
      }
    });

    // Host-only lobby moderation — kick a bot or a fellow human before the
    // game starts. A kicked human gets an explicit room:kicked ping (their
    // socket is still connected, unlike the disconnect/grace-period path)
    // and is removed from the socket.io room so no further broadcasts reach
    // a client that's about to reset its own state and navigate away.
    socket.on('room:kick', ({ targetId } = {}, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        const room = roomManager.getRoom(meta.code);
        const target = room?.members.get(targetId);
        const updated = roomManager.kickMember(meta.code, meta.playerId, targetId);
        if (target && !target.isBot && target.socketId) {
          io.to(target.socketId).emit('room:kicked');
          io.sockets.sockets.get(target.socketId)?.leave(meta.code);
        }
        reply({ ok: true });
        if (updated) broadcastLobbyState(io, updated);
      } catch (err) {
        reply({ ok: false, message: err.message });
      }
    });

    // Leave outside of an in-progress hand — pre-game lobby, or the
    // post-gameover rematch-wait window. A real "leave" button during a hand
    // instead goes through game:forfeitLeave/disconnect's forfeitAndContinue
    // path, which needs actual forfeiture semantics, not an instant free
    // pass.
    socket.on('room:leave', (cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      const room = roomManager.getRoom(meta.code);
      if (room && room.mode === 'multiplayer' && room.status === 'lobby') {
        const updated = roomManager.removeMember(meta.code, meta.playerId);
        if (updated) broadcastLobbyState(io, updated);
      } else if (room && isAwaitingRematch(room)) {
        leaveDuringRematchWait(io, room, meta.playerId);
      }
      meta.code = null;
      meta.playerId = socket.id;
      meta.token = null;
      reply({ ok: true });
    });

    // "Play again" after a multiplayer match ends. Once every current member
    // (readied humans + pre-readied bots) is accounted for, maybeStartRematch
    // deals a fresh match into the same room.
    socket.on('game:readyRematch', (cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      const room = roomManager.getRoom(meta.code);
      if (!room || !isAwaitingRematch(room)) {
        return reply({ ok: false, message: 'ยังไม่สามารถเริ่มเกมใหม่ได้ตอนนี้' });
      }
      room.rematchReady.add(meta.playerId);
      reply({ ok: true });
      broadcastRematchState(io, room);
      maybeStartRematch(io, room);
    });

    socket.on('chat:message', ({ text } = {}) => {
      const room = roomManager.getRoom(meta.code);
      if (!room || room.mode !== 'multiplayer') return; // โหมดบอทไม่มีแชท
      const member = room.members.get(meta.playerId);
      if (!member) return;

      const now = Date.now();
      if (meta.lastChatAt && now - meta.lastChatAt < CHAT_RATE_LIMIT_MS) return;
      const trimmed = String(text || '').trim().slice(0, MAX_CHAT_LENGTH);
      if (!trimmed) return;
      meta.lastChatAt = now;

      io.to(room.code).emit('chat:message', { fromId: member.id, name: member.name, text: trimmed, ts: now });
    });

    // Recovers a session after a page refresh, brief network drop, or the
    // browser tab being suspended and resuming with a new socket — all of
    // which hand this connection a brand-new socket.id. Without this, the
    // human's seat becomes orphaned: the engine keeps running in the
    // background while the client that reconnects has no idea a room ever
    // existed.
    socket.on('room:rejoin', ({ code, playerId, token } = {}, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      const room = roomManager.getRoom(code);
      if (!room) return reply({ ok: false, message: 'ไม่พบห้องนี้แล้ว (เกมอาจจบไปแล้ว)' });

      if (room.mode === 'bot') {
        const human = [...room.members.values()].find((m) => !m.isBot);
        if (!human) return reply({ ok: false, message: 'ไม่พบผู้เล่นในห้องนี้' });

        human.socketId = socket.id;
        meta.code = room.code;
        meta.playerId = human.id;
        socket.join(room.code);

        room.engine.resume();
        reply({ ok: true, code: room.code, mode: room.mode, status: room.status });
        sendStateToMember(io, room, human, room.engine.getState(), { reason: 'rejoined' });
        return;
      }

      // Multiplayer: identity must be proven with the server-issued token —
      // an id alone is not secret (every viewer's game:state/lobby:state
      // already contains every other player's id), so trusting id-only
      // would let any player steal another player's seat just by replaying
      // an id they observed.
      const member = room.members.get(playerId);
      if (!member || member.isBot || member.token !== token) {
        return reply({ ok: false, message: 'ไม่พบผู้เล่นในห้องนี้' });
      }

      member.socketId = socket.id;
      member.connected = true;
      meta.code = room.code;
      meta.playerId = playerId;
      meta.token = token;
      socket.join(room.code);

      reply({ ok: true, code: room.code, mode: room.mode, status: room.status });
      if (room.status === 'playing') {
        room.engine.resume(); // safe no-op if it was never paused
        sendStateToMember(io, room, member, room.engine.getState(), { reason: 'rejoined' });
      } else {
        broadcastLobbyState(io, room);
      }
    });

    socket.on('game:action', ({ action, amount } = {}) => {
      const room = roomManager.getRoom(meta.code);
      if (!room) return;
      try {
        room.engine.handleAction(meta.playerId, action, amount);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('game:pause', () => {
      const room = roomManager.getRoom(meta.code);
      if (room?.mode === 'bot') room.engine.pause();
    });

    socket.on('game:resume', () => {
      const room = roomManager.getRoom(meta.code);
      if (room?.mode === 'bot') room.engine.resume();
    });

    // Bot-mode only — a multiplayer room has other real players in it, so a
    // single socket emitting this must never be able to tear the room down
    // for everyone else. (Previously ungated; that was a live vector for any
    // multiplayer participant to close the room out from under the rest of
    // the table.)
    socket.on('game:leave', () => {
      const room = roomManager.getRoom(meta.code);
      if (room?.mode === 'bot') roomManager.closeRoom(meta.code);
      meta.code = null;
    });

    // Multiplayer's "stop" button — a real, immediate leave (not a
    // disconnect). Mid-hand this reuses forfeitAndContinue exactly as the
    // disconnect grace timer does: remaining stack is forfeited, whatever's
    // already committed to the pot this hand stays there, and the table
    // keeps going for everyone else. During the post-gameover rematch wait
    // there's no hand to forfeit out of, so that window uses the plain
    // membership-removal path instead.
    socket.on('game:forfeitLeave', (cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      const room = roomManager.getRoom(meta.code);
      if (room?.mode === 'multiplayer' && room.status === 'playing') {
        if (isAwaitingRematch(room)) leaveDuringRematchWait(io, room, meta.playerId);
        else forfeitAndContinue(io, room, meta.playerId);
        socket.leave(room.code);
      }
      meta.code = null;
      meta.playerId = socket.id;
      meta.token = null;
      reply({ ok: true });
    });

    socket.on('disconnect', (reason) => {
      if (process.env.DEBUG_POKER) {
        console.log(`${new Date().toISOString()} [disconnect] socket=${socket.id} room=${meta.code} reason=${reason}`);
      }
      if (!meta.code) return;
      const room = roomManager.getRoom(meta.code);
      if (!room) return;

      const member = room.members.get(meta.playerId);
      // A newer connection may have already reconnected/rejoined this seat
      // (member.socketId would point at it) — don't tear down their game.
      if (member && member.socketId !== socket.id) return;

      const { code, playerId } = meta;

      if (room.mode === 'bot') {
        room.engine.pause();
        setTimeout(() => {
          const stillRoom = roomManager.getRoom(code);
          if (!stillRoom) return;
          const stillMember = stillRoom.members.get(playerId);
          if (stillMember && stillMember.socketId !== socket.id) return; // reconnected in time
          roomManager.closeRoom(code);
        }, DISCONNECT_GRACE_MS);
        return;
      }

      // Multiplayer, still in the lobby (no engine running yet) — grace
      // timer, then drop them from the member list and let the others keep
      // configuring/waiting.
      if (room.status === 'lobby') {
        if (member) member.connected = false;
        setTimeout(() => {
          const stillRoom = roomManager.getRoom(code);
          if (!stillRoom) return;
          const stillMember = stillRoom.members.get(playerId);
          if (stillMember && stillMember.socketId !== socket.id) return; // reconnected in time
          const updated = roomManager.removeMember(code, playerId);
          if (updated) broadcastLobbyState(io, updated);
        }, DISCONNECT_GRACE_MS);
        return;
      }

      // Multiplayer, mid-game. Only freeze the table if this seat's decision
      // is actually blocking progress right now — pausing unconditionally
      // (as bot-mode does, where only one human's presence ever matters)
      // would freeze every OTHER connected player's clock on any single
      // disconnect, which is a real problem once there are several real
      // players at the table.
      if (member) member.connected = false;
      if (room.engine.getLegalActions(playerId)) room.engine.pause();
      setTimeout(() => {
        const stillRoom = roomManager.getRoom(code);
        if (!stillRoom) return;
        const stillMember = stillRoom.members.get(playerId);
        if (stillMember && stillMember.socketId !== socket.id) return; // reconnected in time
        if (isAwaitingRematch(stillRoom)) leaveDuringRematchWait(io, stillRoom, playerId);
        else forfeitAndContinue(io, stillRoom, playerId);
      }, DISCONNECT_GRACE_MS);
    });
  });
}
