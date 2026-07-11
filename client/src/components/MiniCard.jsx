const SUIT_SYMBOLS = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RANK_DISPLAY = { T: '10' };

export default function MiniCard({ code }) {
  const rank = code[0];
  const suit = code[1];
  const isRed = suit === 'd' || suit === 'h';
  return (
    <div className={`mini-card ${isRed ? 'mini-card--red' : 'mini-card--black'}`}>
      {(RANK_DISPLAY[rank] || rank) + SUIT_SYMBOLS[suit]}
    </div>
  );
}
