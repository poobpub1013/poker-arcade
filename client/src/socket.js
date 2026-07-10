import { io } from 'socket.io-client';
import { useGameStore } from './store/useGameStore.js';
import * as sound from './components/SoundManager.js';
import { TH } from './i18n/th.js';

const ACTIVE_ROOM_KEY = 'pokergame:activeRoom';

export const socket = io({ autoConnect: true });

// Bot-mode entries just omit playerId/token (room:rejoin's bot-mode path
// doesn't need them — it's always the lone human). Multiplayer entries
// carry the server-issued id+token pair, since an id alone isn't secret
// (every viewer's game:state/lobby:state already contains every other
// player's id) — trusting id-only would let any player steal another
// player's seat just by replaying an id they observed.
function storeActiveRoom({ code, mode, playerId, token }) {
  sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ code, mode, playerId, token }));
}

function clearActiveRoom() {
  sessionStorage.removeItem(ACTIVE_ROOM_KEY);
}

// Fires on the very first connect AND after any reconnect (refresh, brief
// network drop, laptop sleep, tab suspend/resume) — each of which hands the
// browser a brand-new socket.id. Without rejoining, the old seat would be
// orphaned: the engine keeps the game running (with bots, or without this
// player, in multiplayer) while this client has no idea a room ever existed.
socket.on('connect', () => {
  const raw = sessionStorage.getItem(ACTIVE_ROOM_KEY);
  if (!raw) return;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    clearActiveRoom();
    return;
  }
  const payload =
    saved.mode === 'multiplayer'
      ? { code: saved.code, playerId: saved.playerId, token: saved.token }
      : { code: saved.code };
  socket.emit('room:rejoin', payload, (result) => {
    if (result?.ok) {
      useGameStore.getState().setRoom(result.code, result.mode || saved.mode, saved.playerId ?? null);
    } else {
      clearActiveRoom();
    }
  });
});

function playSoundForEvent(state) {
  const event = state.event;
  if (!event) return;

  if (event.reason === 'hand-start') {
    sound.playDealCard();
  } else if (event.reason === 'board-dealt') {
    sound.playFlipCard();
  } else if (event.reason === 'action') {
    if (event.action === 'fold') sound.playFold();
    else if (event.action === 'check') sound.playCheck();
    else sound.playChipBet();
  } else if (event.reason === 'showdown' || event.reason === 'hand-won-uncontested') {
    sound.playFlipCard();
    const result = state.lastResult;
    const youWon =
      (result?.type === 'showdown' && result.pots.some((p) => p.winners.includes(state.you))) ||
      (result?.type === 'uncontested' && result.winnerId === state.you);
    if (youWon) sound.playWin();
  }
}

socket.on('game:state', (state) => {
  useGameStore.getState().applyGameState(state);
  playSoundForEvent(state);
  if (state.phase === 'gameover') clearActiveRoom();
});
socket.on('game:yourTurn', (legal) => {
  useGameStore.getState().applyYourTurn(legal);
  if (legal) sound.playYourTurn();
});
socket.on('lobby:state', (state) => useGameStore.getState().applyLobbyState(state));
socket.on('game:rematchState', (state) => useGameStore.getState().applyRematchState(state));
socket.on('chat:message', (msg) => useGameStore.getState().appendChatMessage(msg));
socket.on('room:kicked', () => {
  clearActiveRoom();
  useGameStore.getState().resetGame();
  useGameStore.getState().applyError(TH.lobby.kickedMessage);
});
socket.on('room:closed', ({ message } = {}) => {
  clearActiveRoom();
  useGameStore.getState().resetGame();
  useGameStore.getState().applyError(message || TH.common.error);
});
socket.on('error', (err) => useGameStore.getState().applyError(err?.message || 'เกิดข้อผิดพลาด'));

export function setProfile(name, avatar) {
  socket.emit('profile:set', { name, avatar });
}

export function startBotGame({ variantId, numPlayers, startingChips, smallBlind, bigBlind, blindIncreaseHands }) {
  return new Promise((resolve) => {
    socket.emit(
      'bots:start',
      { variantId, numPlayers, startingChips, smallBlind, bigBlind, blindIncreaseHands },
      (result) => {
        if (result?.ok) storeActiveRoom({ code: result.code, mode: 'bot' });
        resolve(result);
      }
    );
  });
}

// ---- Multiplayer lobby -----------------------------------------------------

export function createRoom({ variantId, maxPlayers, startingChips, smallBlind, bigBlind, blindIncreaseHands }) {
  return new Promise((resolve) => {
    socket.emit(
      'room:create',
      { variantId, maxPlayers, startingChips, smallBlind, bigBlind, blindIncreaseHands },
      (result) => {
        if (result?.ok) {
          storeActiveRoom({ code: result.code, mode: 'multiplayer', playerId: result.playerId, token: result.token });
          useGameStore.getState().setRoom(result.code, 'multiplayer', result.playerId);
        }
        resolve(result);
      }
    );
  });
}

export function joinRoom(code) {
  return new Promise((resolve) => {
    socket.emit('room:join', { code }, (result) => {
      if (result?.ok) {
        storeActiveRoom({ code: result.code, mode: 'multiplayer', playerId: result.playerId, token: result.token });
        useGameStore.getState().setRoom(result.code, 'multiplayer', result.playerId);
      }
      resolve(result);
    });
  });
}

export function addBotToLobby() {
  return new Promise((resolve) => socket.emit('room:addBot', resolve));
}

export function updateLobbyConfig(maxPlayers) {
  return new Promise((resolve) => socket.emit('room:updateConfig', { maxPlayers }, resolve));
}

export function kickMember(targetId) {
  return new Promise((resolve) => socket.emit('room:kick', { targetId }, resolve));
}

export function startLobbyGame() {
  return new Promise((resolve) => socket.emit('room:start', resolve));
}

// Doubles as the "leave room" action on the post-gameover rematch prompt —
// server-side, room:leave already accepts either the pre-game lobby or that
// same waiting window (see socket/handlers.js).
export function leaveLobby() {
  return new Promise((resolve) => {
    socket.emit('room:leave', (result) => {
      clearActiveRoom();
      useGameStore.getState().resetGame();
      resolve(result);
    });
  });
}

// "Play again" on a multiplayer match's gameover screen.
export function readyForRematch() {
  return new Promise((resolve) => socket.emit('game:readyRematch', resolve));
}

export function sendChatMessage(text) {
  socket.emit('chat:message', { text });
}

// ---- In-hand actions --------------------------------------------------------

export function sendAction(action, amount) {
  socket.emit('game:action', { action, amount });
}

export function pauseGame() {
  socket.emit('game:pause');
}

export function resumeGame() {
  socket.emit('game:resume');
}

export function leaveGame() {
  socket.emit('game:leave');
  clearActiveRoom();
  useGameStore.getState().resetGame();
}

// Multiplayer's "stop" button — an explicit, immediate mid-hand leave
// (distinct from leaveGame, which is bot-mode-only and just closes the
// room). Server forfeits the remaining stack and keeps the table running
// for everyone else.
export function forfeitLeaveGame() {
  return new Promise((resolve) => {
    socket.emit('game:forfeitLeave', (result) => {
      clearActiveRoom();
      useGameStore.getState().resetGame();
      resolve(result);
    });
  });
}
