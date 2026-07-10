import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TH } from '../i18n/th.js';
import { joinRoom } from '../socket.js';

export default function JoinRoom() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    const trimmed = code.trim();
    if (trimmed.length !== 4) {
      setError(TH.joinRoom.invalidCode);
      return;
    }
    setLoading(true);
    setError('');
    const result = await joinRoom(trimmed);
    setLoading(false);
    if (result?.ok) {
      navigate('/lobby');
    } else {
      setError(result?.message || TH.common.error);
    }
  };

  return (
    <div className="screen">
      <div className="screen__header">
        <button className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← {TH.joinRoom.back}
        </button>
        <h1 className="screen__title">{TH.joinRoom.title}</h1>
      </div>
      <div className="screen__body">
        <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="field">
            <label>{TH.joinRoom.codeLabel}</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="0000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              style={{ fontSize: '1.6rem', letterSpacing: '0.3em', textAlign: 'center' }}
            />
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <button className="btn btn--primary" disabled={loading} onClick={handleJoin}>
          {loading ? TH.joinRoom.joining : TH.joinRoom.join}
        </button>
      </div>
    </div>
  );
}
