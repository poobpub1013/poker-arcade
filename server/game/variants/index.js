import texasHoldem from './texasHoldem.js';
import plo from './plo.js';

// Choice Poker [Kakegurui] doesn't fit this descriptor shape at all (no
// streets/blinds/board — heads-up five-card draw with its own engine, see
// choicePokerEngine.js) — this is metadata-only, listed here purely so it
// shows up alongside the other variants wherever this registry is read.
const choicePoker = {
  id: 'choice-poker',
  name: 'Choice Poker [Kakegurui]',
  description: 'ดวลไพ่ 1 ต่อ 1 แบบ Five-Card Draw ห้ามหมอบ/ห้ามตาม เดิมพันได้ไม่จำกัด ใครลงเดิมพันสูงกว่าเลือกได้ว่าจะให้มือแรงชนะหรือมืออ่อนชนะ',
  holeCards: 5,
};

// Doubt Poker [Kakegurui] — same "metadata-only" treatment (own engine, see
// doubtPokerEngine.js). Unlike Choice Poker it keeps normal blinds and a
// 2-9-shaped seat count, but is still nothing like a streets descriptor.
const doubtPoker = {
  id: 'doubt-poker',
  name: 'Doubt Poker [Kakegurui]',
  description:
    'โป๊กเกอร์ 5 ใบผสมเกมจับโกหก: เดิมพันปกติ ประกาศแต้มมือได้ทั้งจริงและหลอก แล้วให้คนอื่นจ่ายเงินจับผิด ใครโกหกโดนจับหมดสิทธิ์ชนะกองกลางทันที',
  holeCards: 5,
};

const registry = new Map([
  [texasHoldem.id, texasHoldem],
  [plo.id, plo],
  [choicePoker.id, choicePoker],
  [doubtPoker.id, doubtPoker],
]);

export function getVariant(id) {
  return registry.get(id);
}

export function listVariants() {
  return [...registry.values()].map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    holeCards: v.holeCards,
    available: true,
  }));
}
