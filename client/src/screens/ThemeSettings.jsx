import { useNavigate } from 'react-router-dom';
import { useProfile } from '../store/useProfile.js';
import { TH } from '../i18n/th.js';

const THEMES = [
  { id: 'classic', label: TH.theme.classic, bg: '#eef2f0', accent: '#2f9e63', dark: false },
  { id: 'dark', label: TH.theme.dark, bg: '#14171c', accent: '#5b8cff', dark: true },
  { id: 'japanese', label: TH.theme.japanese, bg: '#fbeef0', accent: '#d1495b', dark: false },
  { id: 'casino', label: TH.theme.casino, bg: '#0e1f16', accent: '#d8b04a', dark: true },
  { id: 'neon', label: TH.theme.neon, bg: '#0b0620', accent: '#ff3ec8', dark: true },
];

export default function ThemeSettings() {
  const navigate = useNavigate();
  const theme = useProfile((s) => s.theme);
  const setTheme = useProfile((s) => s.setTheme);

  return (
    <div className="screen">
      <div className="screen__header">
        <button className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← {TH.theme.back}
        </button>
        <h1 className="screen__title">{TH.theme.title}</h1>
      </div>
      <div className="screen__body">
        <div className="theme-grid">
          {THEMES.map((t) => (
            <div
              key={t.id}
              className={`theme-swatch ${theme === t.id ? 'theme-swatch--selected' : ''}`}
              style={{ background: t.bg }}
              onClick={() => setTheme(t.id)}
            >
              <div className="theme-swatch__preview" style={{ background: t.accent }} />
              <span className="theme-swatch__label" style={{ color: t.dark ? '#fff' : '#222' }}>
                {t.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
