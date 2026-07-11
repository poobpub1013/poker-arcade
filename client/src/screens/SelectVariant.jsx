import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import { TH } from '../i18n/th.js';
import { VARIANT_RULES } from '../data/variantRules.js';

const VARIANTS = [
  {
    id: 'texas-holdem',
    name: VARIANT_RULES['texas-holdem'].name,
    desc: 'แจกไพ่ในมือ 2 ใบ เล่นได้เลยตอนนี้',
    available: true,
    rules: VARIANT_RULES['texas-holdem'].rules,
  },
  {
    id: 'plo',
    name: VARIANT_RULES.plo.name,
    desc: 'แจกไพ่ในมือ 4 ใบ ต้องใช้ 2 ใบพอดี',
    available: true,
    rules: VARIANT_RULES.plo.rules,
  },
  {
    id: 'choice-poker',
    name: VARIANT_RULES['choice-poker'].name,
    desc: 'ดวล 1 ต่อ 1 แบบ Five-Card Draw ห้ามหมอบ/ห้ามตาม ใครเดิมพันสูงกว่าเลือกได้ว่าจะให้มือแรงหรือมืออ่อนชนะ',
    available: true,
    rules: VARIANT_RULES['choice-poker'].rules,
  },
  {
    id: 'doubt-poker',
    name: VARIANT_RULES['doubt-poker'].name,
    desc: 'โป๊กเกอร์ 5 ใบ (2-6 คน) ผสมเกมจับโกหก เดิมพันปกติแล้วประกาศแต้มมือได้ทั้งจริง/หลอก ใครโดนจับโกหกหมดสิทธิ์ชนะทันที',
    available: true,
    rules: VARIANT_RULES['doubt-poker'].rules,
  },
  {
    id: 'other',
    name: 'โป๊กเกอร์อื่นๆ',
    desc: 'จะทยอยเพิ่มประเภทใหม่ๆ ในอนาคต',
    available: false,
  },
];

function RulesModal({ variant, onClose }) {
  if (!variant) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel--wide" onClick={(e) => e.stopPropagation()}>
        <h3>{variant.name}</h3>
        <ul className="rules-list">
          {variant.rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <button className="btn btn--primary" onClick={onClose}>
          {TH.common.ok}
        </button>
      </div>
    </div>
  );
}

export default function SelectVariant() {
  const navigate = useNavigate();
  const setSelectedVariantId = useGameStore((s) => s.setSelectedVariantId);
  const [helpVariant, setHelpVariant] = useState(null);

  const handleSelect = (variant) => {
    if (!variant.available) return;
    setSelectedVariantId(variant.id);
    navigate('/select-mode');
  };

  return (
    <div className="screen">
      <div className="screen__header">
        <button className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← {TH.variant.back}
        </button>
        <h1 className="screen__title">{TH.variant.title}</h1>
      </div>
      <div className="screen__body">
        <div className="option-grid">
          {VARIANTS.map((v) => (
            <div
              key={v.id}
              className={`option-card ${!v.available ? 'option-card--disabled' : ''}`}
              onClick={() => handleSelect(v)}
            >
              {v.available && (
                <button
                  className="option-card__help"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHelpVariant(v);
                  }}
                  title={TH.variant.howToPlay}
                  aria-label={TH.variant.howToPlay}
                >
                  ?
                </button>
              )}
              <h3>{v.name}</h3>
              <p>{v.desc}</p>
              {!v.available && <span className="option-card__badge">{TH.variant.comingSoon}</span>}
            </div>
          ))}
        </div>
      </div>
      <RulesModal variant={helpVariant} onClose={() => setHelpVariant(null)} />
    </div>
  );
}
