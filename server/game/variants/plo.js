export default {
  id: 'plo',
  name: 'PLO (Pot-Limit Omaha)',
  description: 'แจกไพ่ในมือ 4 ใบ ต้องใช้ไพ่ในมือ "พอดี 2 ใบ" ร่วมกับไพ่กลาง 3 ใบเสมอ เดิมพันสูงสุดได้ไม่เกินขนาดพอต',
  holeCards: 4,
  boardCards: 5,
  holeCardsUsed: { exactly: 2 },
  bettingStructure: 'pot-limit',
  streets: [
    { name: 'preflop', dealToBoard: 0 },
    { name: 'flop', dealToBoard: 3 },
    { name: 'turn', dealToBoard: 1 },
    { name: 'river', dealToBoard: 1 },
  ],
};
