export default {
  id: 'texas-holdem',
  name: "โป๊กเกอร์ปกติ (Texas Hold'em)",
  description: 'แจกไพ่ในมือ 2 ใบ ใช้ร่วมกับไพ่กลาง 5 ใบ เลือกไพ่ 5 ใบที่ดีที่สุดจากทั้งหมด 7 ใบ',
  holeCards: 2,
  boardCards: 5,
  holeCardsUsed: null,
  bettingStructure: 'no-limit',
  streets: [
    { name: 'preflop', dealToBoard: 0 },
    { name: 'flop', dealToBoard: 3 },
    { name: 'turn', dealToBoard: 1 },
    { name: 'river', dealToBoard: 1 },
  ],
};
