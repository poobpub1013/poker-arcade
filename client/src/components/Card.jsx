const SUIT_SYMBOLS = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RANK_DISPLAY = { T: '10' };

export default function Card({ code, size = 'md' }) {
  if (!code) {
    return <div className={`card card--back card--${size}`} />;
  }
  const rank = code[0];
  const suit = code[1];

  if (rank === 'O') {
    return (
      <div className={`card card--${size} card--joker`}>
        <span className="card__joker-corner card__joker-corner--tl">★</span>
        <svg className="card__joker-icon" viewBox="0 0 48 44" aria-hidden="true">
          <polygon className="card__joker-cap" points="5,38 19,38 12,18" />
          <polygon className="card__joker-cap" points="16,38 32,38 24,8" />
          <polygon className="card__joker-cap" points="29,38 43,38 36,18" />
          <rect className="card__joker-cap" x="4" y="36" width="40" height="6" rx="3" />
          <circle className="card__joker-bell" cx="12" cy="15" r="3.4" />
          <circle className="card__joker-bell" cx="24" cy="5" r="3.8" />
          <circle className="card__joker-bell" cx="36" cy="15" r="3.4" />
        </svg>
        <span className="card__joker-corner card__joker-corner--br">★</span>
      </div>
    );
  }

  const isRed = suit === 'd' || suit === 'h';
  return (
    <div className={`card card--${size} ${isRed ? 'card--red' : 'card--black'}`}>
      <span className="card__rank">{RANK_DISPLAY[rank] || rank}</span>
      <span className="card__suit">{SUIT_SYMBOLS[suit]}</span>
    </div>
  );
}
