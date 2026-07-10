import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import { TH } from '../i18n/th.js';

const VARIANTS = [
  {
    id: 'texas-holdem',
    name: "โป๊กเกอร์ปกติ (Texas Hold'em)",
    desc: 'แจกไพ่ในมือ 2 ใบ เล่นได้เลยตอนนี้',
    available: true,
    rules: [
      'แจกไพ่ปิด (ไพ่ในมือ) ให้ผู้เล่นคนละ 2 ใบ',
      'มีไพ่กลาง (Community Cards) 5 ใบ แจกทีละล็อต: Flop 3 ใบ, Turn 1 ใบ, River 1 ใบ และเปิดวงเดิมพันหลังแจกแต่ละล็อต',
      'แต่ละวงเดิมพันเลือกได้ว่าจะ หมอบ / เช็ค / ตาม / เรซ / ออลอิน — เดิมพันแบบ No-Limit คือเรซได้ไม่จำกัดจำนวน',
      'ตอนโชว์ไพ่ ใช้ไพ่ 5 ใบที่ดีที่สุดจากไพ่ในมือ 2 ใบ + ไพ่กลาง 5 ใบ (จะเลือกใช้ไพ่ในมือกี่ใบก็ได้ ตั้งแต่ 0-2 ใบ)',
      'มีบลายด์ (Small Blind / Big Blind) หมุนเวียนตามตำแหน่งดีลเลอร์ทุกมือ',
      'ใครชิพหมดถือว่าตกรอบ เหลือผู้เล่นคนเดียวจบเกม',
    ],
  },
  {
    id: 'plo',
    name: 'PLO (Pot-Limit Omaha)',
    desc: 'แจกไพ่ในมือ 4 ใบ ต้องใช้ 2 ใบพอดี',
    available: true,
    rules: [
      "โครงสร้างเกมเหมือน Texas Hold'em เกือบทั้งหมด (ไพ่กลาง 5 ใบ, บลายด์, มีวงเดิมพัน 4 รอบ) แต่มี 2 จุดต่างสำคัญ",
      'แจกไพ่ในมือ 4 ใบแทน 2 ใบ',
      'ตอนโชว์ไพ่ ต้องใช้ไพ่ในมือ "พอดี 2 ใบเท่านั้น" ผสมกับไพ่กลาง 3 ใบเสมอ ห้ามใช้ไพ่ในมือ 1, 3 หรือ 4 ใบ — เป็นกฎที่พลาดบ่อยที่สุดของ PLO',
      "เดิมพันแบบ Pot-Limit คือเรซได้สูงสุดไม่เกินขนาดกองกลาง ณ ตอนนั้น (ต่างจาก Hold'em ที่เดิมพันได้ไม่จำกัด)",
      "ที่เหลือ (หมอบ/เช็ค/ตาม/บลายด์/โชว์ไพ่) เหมือน Texas Hold'em ทุกอย่าง",
    ],
  },
  {
    id: 'choice-poker',
    name: 'Choice Poker [Kakegurui]',
    desc: 'ดวล 1 ต่อ 1 แบบ Five-Card Draw ห้ามหมอบ/ห้ามตาม ใครเดิมพันสูงกว่าเลือกได้ว่าจะให้มือแรงหรือมืออ่อนชนะ',
    available: true,
    rules: [
      'เล่นได้แค่ 2 คน (ดวลตัวต่อตัวเท่านั้น)',
      'ใช้ไพ่ 53 ใบ (52 ใบปกติ + โจ๊กเกอร์ 1 ใบ) โจ๊กเกอร์ถือเป็นไพ่แรงที่สุดในเกม',
      'แจกไพ่ 5 ใบต่อคน แล้วแลกไพ่ได้ 1 ครั้ง (จะทิ้งกี่ใบก็ได้ 0-5 ใบ)',
      'ไพ่ใบใหม่ที่จั่วมาแทนจะหงายให้อีกฝ่ายเห็น แต่ไพ่เดิมที่เก็บไว้ยังคว่ำเป็นความลับจนกว่าจะถึงตอนโชว์ไพ่จริง — ใช้บลัฟฟ์และคำนวณความน่าจะเป็นได้จากตรงนี้',
      'ไม่มีหมอบและไม่มีตาม มีแค่ "เดิมพัน/เรซ" กับ "หยุด (Stand)" เท่านั้น และเดิมพันได้ไม่จำกัดจำนวนรอบ',
      'เมื่อฝ่ายหนึ่งเลือกหยุด อีกฝ่าย (ซึ่งต้องเป็นคนที่เดิมพันรวมสูงกว่า) จะเป็นคนเลือกว่าจะให้ไพ่แรงชนะ (Stronger) หรือไพ่อ่อนชนะ (Weaker)',
      'กองกลางเป็นแบบผู้ชนะกินหมด แม้เดิมพันของสองฝ่ายจะไม่เท่ากันก็ตาม',
    ],
  },
  {
    id: 'doubt-poker',
    name: 'Doubt Poker [Kakegurui]',
    desc: 'โป๊กเกอร์ 5 ใบ (2-6 คน) ผสมเกมจับโกหก เดิมพันปกติแล้วประกาศแต้มมือได้ทั้งจริง/หลอก ใครโดนจับโกหกหมดสิทธิ์ชนะทันที',
    available: true,
    rules: [
      'เล่นได้ 2-6 คน',
      'แจกไพ่ 5 ใบต่อคน แลกไพ่ได้ 1 ครั้งแบบปิด ไม่มีใครเห็นว่าใครทิ้ง/จั่วอะไรมา',
      'เดิมพันแบบปกติ มีบลายด์ และเลือกหมอบ/เช็ค/ตาม/เรซ/ออลอินได้',
      'หลังปิดวงเดิมพัน ผู้เล่นที่เหลือทุกคนต้อง "ประกาศ" แต้มมือของตัวเอง (เลือกประเภทมือ + แต้มสูงสุด) จะพูดจริงหรือโกหกก็ได้',
      'จากนั้นเข้าสู่รอบจับโกหก (Doubt) — ทุกคนได้ 1 ตา จ่ายเงินเท่ากับเดิมพันสุดท้ายของวงนั้นเพื่อจับโกหกคนอื่นได้ 1 คน (จะจับหรือผ่านก็ได้ และจับคนที่เปิดไพ่ไปแล้วไม่ได้)',
      'ถ้าจับถูก (โกหกจริง) คนที่โกหกจะถูกตัดสิทธิ์ชนะกองกลางทันที แต่เงินที่ลงไปแล้วยังอยู่ในกองกลางเหมือนเดิม',
      'ถ้าจับผิด (พูดจริง หรือประกาศต่ำกว่ามือจริง) ไพ่จะถูกเปิดและยังมีสิทธิ์ชนะกองกลางตามปกติ',
      'ใครไม่โดนจับเลยจนจบรอบ จะใช้ "แต้มที่ประกาศไว้" ไม่ใช่ไพ่จริง มาตัดสินตอนโชว์ไพ่สุดท้าย ต่อให้โกหกก็ชนะได้ถ้าไม่มีใครจับได้',
    ],
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
