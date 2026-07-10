import { useNavigate } from 'react-router-dom';
import { TH } from '../i18n/th.js';

const SUIT_SYMBOLS = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RANK_DISPLAY = { T: '10' };

function MiniCard({ code }) {
  const rank = code[0];
  const suit = code[1];
  const isRed = suit === 'd' || suit === 'h';
  return (
    <div className={`mini-card ${isRed ? 'mini-card--red' : 'mini-card--black'}`}>
      {(RANK_DISPLAY[rank] || rank) + SUIT_SYMBOLS[suit]}
    </div>
  );
}

export default function HowToPlay() {
  const navigate = useNavigate();
  return (
    <div className="screen">
      <div className="screen__header">
        <button className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← {TH.howToPlay.back}
        </button>
        <h1 className="screen__title">{TH.howToPlay.title}</h1>
      </div>
      <div className="screen__body">
        <div className="card-panel">
          <p>{TH.howToPlay.intro}</p>
          <ul>
            {TH.howToPlay.basics.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>

        <h2 style={{ margin: '4px 0' }}>{TH.howToPlay.rankingTitle}</h2>
        <div className="hand-rank-list">
          {TH.howToPlay.rankings.map((r, i) => (
            <div key={r.name} className="hand-rank-row">
              <span className="hand-rank-row__index">{i + 1}</span>
              <div className="hand-rank-row__info">
                <h4>{r.name}</h4>
                <p>{r.desc}</p>
              </div>
              <div className="hand-rank-row__cards">
                {r.example.map((c, idx) => (
                  <MiniCard key={idx} code={c} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <h2 style={{ margin: '4px 0' }}>{TH.howToPlay.termsTitle}</h2>
        <div className="card-panel">
          <ul>
            {TH.howToPlay.terms.map(([term, desc]) => (
              <li key={term}>
                <strong>{term}:</strong> {desc}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
