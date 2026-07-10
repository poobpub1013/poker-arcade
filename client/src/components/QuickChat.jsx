import { TH } from '../i18n/th.js';

export default function QuickChat({ onPick }) {
  return (
    <div className="quick-chat-row">
      {TH.chat.quickPhrases.map((phrase) => (
        <button key={phrase} className="chip-pill" onClick={() => onPick(phrase)}>
          {phrase}
        </button>
      ))}
    </div>
  );
}
