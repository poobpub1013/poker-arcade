import { useState } from 'react';
import { TH } from '../i18n/th.js';
import { VARIANT_RULES } from '../data/variantRules.js';
import MiniCard from './MiniCard.jsx';

// In-game "?" rules reference — a friend forgetting the rules mid-match was
// the whole reason this exists, so it needs to work *during* a hand, not
// just before one starts. Mirrors Chat.jsx's floating-icon-button + anchored
// panel pattern (no full-screen backdrop) specifically so it never blocks
// the felt, the player's own cards, or the action timer while it's open.
export default function RulesHelp({ variantId }) {
  const [open, setOpen] = useState(false);
  const variant = VARIANT_RULES[variantId];
  if (!variant) return null;

  return (
    <>
      <button
        className="btn btn--icon rules-btn"
        onClick={() => setOpen((v) => !v)}
        title={TH.variant.howToPlay}
        aria-label={TH.variant.howToPlay}
      >
        ?
      </button>
      {open && (
        <div className="rules-panel">
          <div className="rules-panel__header">
            <h3>{variant.name}</h3>
            <button className="rules-panel__close" onClick={() => setOpen(false)} aria-label={TH.common.close}>
              ×
            </button>
          </div>
          <div className="rules-panel__body">
            <ul className="rules-list">
              {variant.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>

            <h4 className="rules-panel__subtitle">{TH.howToPlay.rankingTitle}</h4>
            <div className="hand-rank-list hand-rank-list--compact">
              {TH.howToPlay.rankings.map((r, i) => (
                <div key={r.name} className="hand-rank-row">
                  <span className="hand-rank-row__index">{i + 1}</span>
                  <div className="hand-rank-row__info">
                    <h4>{r.name}</h4>
                  </div>
                  <div className="hand-rank-row__cards">
                    {r.example.map((c, idx) => (
                      <MiniCard key={idx} code={c} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {variantId === 'choice-poker' && (
              <ul className="rules-list">
                {TH.choicePoker.rankingNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
