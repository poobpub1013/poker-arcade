import { useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import ThemeProvider from './components/ThemeProvider.jsx';
import Home from './screens/Home.jsx';
import HowToPlay from './screens/HowToPlay.jsx';
import ThemeSettings from './screens/ThemeSettings.jsx';
import SelectVariant from './screens/SelectVariant.jsx';
import SelectMode from './screens/SelectMode.jsx';
import BotSetup from './screens/BotSetup.jsx';
import CreateRoom from './screens/CreateRoom.jsx';
import JoinRoom from './screens/JoinRoom.jsx';
import Lobby from './screens/Lobby.jsx';
import Table from './screens/Table.jsx';
import { useProfile } from './store/useProfile.js';
import { useGameStore } from './store/useGameStore.js';

function MuteButton() {
  const muted = useProfile((s) => s.muted);
  const toggleMuted = useProfile((s) => s.toggleMuted);
  return (
    <button className="btn btn--icon mute-btn" onClick={toggleMuted} title={muted ? 'เปิดเสียง' : 'ปิดเสียง'}>
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

// After an automatic rejoin (page refresh, brief disconnect, tab resume),
// roomCode gets set from wherever the user happens to be (often Home, on a
// fresh page load) — this carries them back without a click. A rejoin can
// land either mid-game or still in a multiplayer lobby, so wait for
// whichever state actually arrives (gameState vs. lobbyState) before
// deciding where to send them, rather than always assuming /table.
function RoomRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const roomCode = useGameStore((s) => s.roomCode);
  const gameState = useGameStore((s) => s.gameState);
  const lobbyState = useGameStore((s) => s.lobbyState);

  useEffect(() => {
    if (roomCode) {
      const target = gameState ? '/table' : lobbyState ? '/lobby' : null;
      if (target && location.pathname !== target) navigate(target);
      return;
    }
    // Room membership just ended from under us (kicked by the host, grace
    // period expired) while still sitting on a room-only screen — get out
    // rather than leaving the user stuck on a screen with no state to show.
    if (location.pathname === '/table' || location.pathname === '/lobby') {
      navigate('/');
    }
  }, [roomCode, gameState, lobbyState, location.pathname, navigate]);

  return null;
}

function GlobalError() {
  const serverError = useGameStore((s) => s.serverError);
  const clearError = useGameStore((s) => s.clearError);
  if (!serverError) return null;
  return (
    <div
      className="error-banner"
      style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 60, cursor: 'pointer' }}
      onClick={clearError}
    >
      {serverError}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MuteButton />
      <GlobalError />
      <RoomRedirect />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/how-to-play" element={<HowToPlay />} />
        <Route path="/theme" element={<ThemeSettings />} />
        <Route path="/select-variant" element={<SelectVariant />} />
        <Route path="/select-mode" element={<SelectMode />} />
        <Route path="/bot-setup" element={<BotSetup />} />
        <Route path="/create-room" element={<CreateRoom />} />
        <Route path="/join-room" element={<JoinRoom />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/table" element={<Table />} />
      </Routes>
    </ThemeProvider>
  );
}
