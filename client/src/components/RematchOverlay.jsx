import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import { TH } from '../i18n/th.js';
import { readyForRematch, leaveLobby } from '../socket.js';

// Multiplayer's gameover screen: play again (waits on everyone else, shows
// who hasn't readied up yet) or leave the room. Bot-mode's gameover overlay
// stays the simple "back to home" version — a rematch only makes sense once
// there are other humans to wait on.
export default function RematchOverlay({ winnerName }) {
  const navigate = useNavigate();
  const rematchState = useGameStore((s) => s.rematchState);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const [leaving, setLeaving] = useState(false);

  const iAmReady = !!rematchState?.readyIds.includes(myPlayerId);
  const notReadyPlayers = (rematchState?.players || []).filter((p) => !rematchState.readyIds.includes(p.id));

  const handleReady = () => readyForRematch();

  const handleLeave = async () => {
    setLeaving(true);
    await leaveLobby();
    navigate('/');
  };

  return (
    <div className="gameover-overlay">
      <div className="modal-panel" style={{ textAlign: 'center' }}>
        <h2>{TH.table.gameOver}</h2>
        <p>{TH.table.winnerIs(winnerName)}</p>

        {iAmReady ? (
          <>
            <p>{TH.table.rematchWaiting}</p>
            {notReadyPlayers.length > 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {TH.table.rematchWaitingFor(notReadyPlayers.map((p) => p.name).join(', '))}
              </p>
            )}
          </>
        ) : (
          <div className="btn-stack">
            <button className="btn btn--primary" onClick={handleReady}>
              {TH.table.playAgain}
            </button>
            <button className="btn btn--danger" onClick={handleLeave} disabled={leaving}>
              {TH.table.leaveRoom}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
