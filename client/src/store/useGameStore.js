import { create } from 'zustand';

const MAX_CHAT_MESSAGES = 100;

export const useGameStore = create((set) => ({
  selectedVariantId: null,
  setSelectedVariantId: (id) => set({ selectedVariantId: id }),

  roomCode: null,
  roomMode: null, // 'bot' | 'multiplayer'
  myPlayerId: null,
  setRoom: (code, mode, playerId = null) => set({ roomCode: code, roomMode: mode, myPlayerId: playerId }),

  lobbyState: null,
  applyLobbyState: (state) => set({ lobbyState: state }),

  // Only non-null while a multiplayer match's gameover screen is waiting on
  // "play again" decisions — see socket.js's game:rematchState listener.
  rematchState: null,
  applyRematchState: (state) => set({ rematchState: state }),

  chatMessages: [],
  appendChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg].slice(-MAX_CHAT_MESSAGES) })),

  gameState: null,
  legalActions: null,
  serverError: null,

  // Reaching the table means the lobby phase is over. rematchState is only
  // ever meaningful while still on the gameover screen — once a rematch
  // actually deals a fresh hand (phase moves off 'gameover'), drop it so a
  // stale ready-list can't linger into the new match.
  applyGameState: (state) =>
    set((s) => ({
      gameState: state,
      legalActions: null,
      lobbyState: null,
      rematchState: state.phase === 'gameover' ? s.rematchState : null,
    })),
  applyYourTurn: (legal) => set({ legalActions: legal }),
  applyError: (message) => set({ serverError: message }),
  clearError: () => set({ serverError: null }),

  resetGame: () =>
    set({
      gameState: null,
      legalActions: null,
      roomCode: null,
      roomMode: null,
      myPlayerId: null,
      lobbyState: null,
      rematchState: null,
      chatMessages: [],
    }),
}));
