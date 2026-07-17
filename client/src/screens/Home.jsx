import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../store/useProfile.js';
import AvatarUpload from '../components/AvatarUpload.jsx';
import { TH } from '../i18n/th.js';
import { setProfile } from '../socket.js';

export default function Home() {
  const navigate = useNavigate();
  const name = useProfile((s) => s.name);
  const avatar = useProfile((s) => s.avatar);
  const setName = useProfile((s) => s.setName);
  const setAvatar = useProfile((s) => s.setAvatar);
  const saveProfile = useProfile((s) => s.saveProfile);
  const [error, setError] = useState('');

  const handleStart = () => {
    if (!name.trim()) {
      setError(TH.home.nameRequired);
      return;
    }
    saveProfile();
    setProfile(name.trim(), avatar);
    navigate('/select-variant');
  };

  return (
    <div className="screen">
      <div className="screen__body" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h1 className="app-logo">{TH.appName}</h1>
        <p className="app-logo__suits" aria-hidden="true">
          <span>♠</span>
          <span className="suit--red">♥</span>
          <span className="suit--red">♦</span>
          <span>♣</span>
        </p>

        <AvatarUpload name={name} avatar={avatar} onChange={setAvatar} />

        <div className="field">
          <label>{TH.home.nameLabel}</label>
          <input
            type="text"
            value={name}
            placeholder={TH.home.namePlaceholder}
            maxLength={20}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
          />
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="btn-stack">
          <button className="btn btn--primary" onClick={handleStart}>
            {TH.home.startGame}
          </button>
          <button className="btn" onClick={() => navigate('/how-to-play')}>
            {TH.home.howToPlay}
          </button>
          <button className="btn" onClick={() => navigate('/theme')}>
            {TH.home.themeSettings}
          </button>
        </div>
      </div>
    </div>
  );
}
