import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TH } from '../i18n/th.js';

export default function SelectMode() {
  const navigate = useNavigate();
  const [showMultiplayerChoice, setShowMultiplayerChoice] = useState(false);

  return (
    <div className="screen">
      <div className="screen__header">
        <button className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← {TH.mode.back}
        </button>
        <h1 className="screen__title">{TH.mode.title}</h1>
      </div>
      <div className="screen__body">
        <div className="option-grid">
          <div className="option-card" onClick={() => navigate('/bot-setup')}>
            <h3>{TH.mode.vsBot}</h3>
            <p>{TH.mode.vsBotDesc}</p>
          </div>
          <div className="option-card" onClick={() => setShowMultiplayerChoice((v) => !v)}>
            <h3>{TH.mode.vsPlayers}</h3>
            <p>{TH.mode.vsPlayersDesc}</p>
          </div>
        </div>
        {showMultiplayerChoice && (
          <div className="btn-stack">
            <button className="btn btn--primary" onClick={() => navigate('/create-room')}>
              {TH.createRoom.title}
            </button>
            <button className="btn" onClick={() => navigate('/join-room')}>
              {TH.joinRoom.title}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
