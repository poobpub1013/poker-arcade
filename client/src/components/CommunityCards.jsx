import Card from './Card.jsx';

export default function CommunityCards({ board = [] }) {
  const placeholders = Array.from({ length: Math.max(0, 5 - board.length) });
  return (
    <div className="community-cards">
      {board.map((code, i) => (
        <Card key={i} code={code} size="lg" />
      ))}
      {placeholders.map((_, i) => (
        <div key={`ph-${i}`} className="card card--placeholder card--lg" />
      ))}
    </div>
  );
}
