import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import { TH } from '../i18n/th.js';
import { addBotToLobby, updateLobbyConfig, startLobbyGame, leaveLobby, kickMember } from '../socket.js';
import DefaultAvatar from '../components/DefaultAvatar.jsx';

export default function Lobby() {
  const navigate = useNavigate();
  const lobbyState = useGameStore((s) => s.lobbyState);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  if (!lobbyState) {
    return (
      <div className="screen">
        <p>{TH.common.loading}</p>
      </div>
    );
  }

  const isHost = myPlayerId === lobbyState.hostId;
  const isFixedSize = lobbyState.variantId === 'choice-poker';
  const canStart = lobbyState.players.length >= 2;

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(lobbyState.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleAddBot = async () => {
    setError('');
    const result = await addBotToLobby();
    if (!result?.ok) setError(result?.message || TH.common.error);
  };

  const handleMaxPlayersChange = async (value) => {
    setError('');
    const result = await updateLobbyConfig(value);
    if (!result?.ok) setError(result?.message || TH.common.error);
  };

  const handleStart = async () => {
    setError('');
    setStarting(true);
    const result = await startLobbyGame();
    setStarting(false);
    if (!result?.ok) setError(result?.message || TH.common.error);
  };

  const handleLeave = async () => {
    await leaveLobby();
    navigate('/');
  };

  const handleKick = async (targetId) => {
    setError('');
    const result = await kickMember(targetId);
    if (!result?.ok) setError(result?.message || TH.common.error);
  };

  return (
    <div className="screen">
      <div className="screen__header">
        <button className="btn btn--ghost" onClick={handleLeave}>
          ← {TH.lobby.leave}
        </button>
        <h1 className="screen__title">{TH.lobby.title}</h1>
      </div>
      <div className="screen__body">
        <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>{TH.lobby.roomCode}</span>
            <button className="btn btn--ghost" onClick={handleCopyCode} style={{ fontSize: '1.4rem', letterSpacing: '0.3em' }}>
              {lobbyState.code} {copied ? '✓' : '📋'}
            </button>
          </div>

          <div className="btn-stack" style={{ gap: 8 }}>
            {lobbyState.players.map((p) => (
              <div
                key={p.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}
              >
                <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                  {p.avatar ? (
                    <img src={p.avatar} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <DefaultAvatar seed={p.name} size={40} />
                  )}
                </div>
                <span style={{ flex: 1 }}>{p.name}</span>
                {p.id === lobbyState.hostId && <span className="badge badge--dealer">{TH.lobby.hostTag}</span>}
                {p.isBot && <span className="badge">{TH.lobby.botTag}</span>}
                {!p.isBot && p.connected === false && <span className="badge">{TH.lobby.disconnectedTag}</span>}
                {isHost && p.id !== myPlayerId && (
                  <button className="btn btn--ghost btn--kick" onClick={() => handleKick(p.id)} title={TH.lobby.kick}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {isHost && !isFixedSize && (
            <div className="field">
              <label>
                {TH.lobby.maxPlayers}: {lobbyState.maxPlayers}
              </label>
              <input
                type="range"
                min={Math.max(2, lobbyState.players.length)}
                max={lobbyState.variantId === 'doubt-poker' ? 6 : 9}
                value={lobbyState.maxPlayers}
                onChange={(e) => handleMaxPlayersChange(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}

        {isHost ? (
          <div className="btn-stack">
            <button
              className="btn"
              onClick={handleAddBot}
              disabled={lobbyState.players.length >= lobbyState.maxPlayers}
            >
              {TH.lobby.addBot}
            </button>
            <button className="btn btn--primary" onClick={handleStart} disabled={!canStart || starting}>
              {starting ? TH.lobby.starting : TH.lobby.start}
            </button>
          </div>
        ) : (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{TH.lobby.waitingForHost}</p>
        )}
      </div>
    </div>
  );
}
