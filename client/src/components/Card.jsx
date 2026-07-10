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
        <span className="card__joker-icon">🃏</span>
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
