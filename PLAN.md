# PokerGame — แผนงานสำหรับการพัฒนา (Implementation Plan)

> เอกสารนี้เป็นสเปคหลักให้ผู้พัฒนา (Sonnet) อ่านแล้วลงมือทำต่อได้ทันที
> เขียนคำอธิบายเป็นภาษาไทย ส่วนชื่อไฟล์/ตัวแปร/โค้ดใช้ภาษาอังกฤษ
> **UI ทั้งหมดในเว็บเป็นภาษาไทย**

---

## 0. การตัดสินใจที่ล็อกแล้ว (Locked decisions)

| หัวข้อ | ค่าที่เลือก |
|---|---|
| Stack | **Node + Express + Socket.IO** (backend), **React + Vite** (frontend), deploy เป็น service เดียวบน **Render free tier** |
| ภาษา UI | **ไทยล้วน** |
| รูปแบบเกม | **Cash game บลายด์คงที่ — ชิพหมด = ตกรอบ** เล่นจนเหลือผู้เล่นคนสุดท้าย |
| ลำดับงาน | **แบ่ง 3 เฟส** (Phase 1 → 2 → 3) |
| ความถูกต้องของเกม | **Server-authoritative** เสมอ (ทั้งโหมดบอทและโหมดผู้เล่น) ไคลเอนต์ไม่ตัดสินผลเอง |
| ไพ่ของผู้เล่นคนอื่น | **ห้ามส่งไป client** จนกว่าจะถึง showdown ที่ต้องเปิดจริง |

---

## 1. ภาพรวมสถาปัตยกรรม

- **หนึ่ง Node process** ทำหน้าที่ 2 อย่าง: (1) เสิร์ฟไฟล์ React ที่ build แล้ว (static) (2) รัน Socket.IO + เอนจินเกม
- **State เก็บใน memory** (Map ของ rooms) ไม่มี database — เพียงพอสำหรับผู้เล่นพร้อมกัน ≤ 50 คน
- **เอนจินเกมรันบนเซิร์ฟเวอร์ทั้งสองโหมด** แม้แต่โหมดเล่นกับบอท (ห้องนั้นมีมนุษย์ 1 คน + บอท) → ใช้โค้ดเอนจิน + หน้า Table ชุดเดียวกันทั้งสองโหมด ลดโค้ดซ้ำ
- **ไคลเอนต์เป็น thin client**: ส่ง action (fold/call/raise/…) ขึ้นเซิร์ฟเวอร์, เซิร์ฟเวอร์ตรวจสอบ + คำนวณ + broadcast state ที่กรองข้อมูลรายคนกลับมา
- โปรไฟล์ผู้เล่น (ชื่อ + รูป) เก็บฝั่ง client ใน **localStorage** ไม่มีระบบ login/บัญชี

```
[Browser: React app] --socket.io--> [Node: Socket.IO + Game Engine (in-memory rooms)]
        |                                        |
   localStorage                          serve built React (static)
 (profiles, theme)
```

---

## 2. โครงสร้างโปรเจกต์

```
PokerGame/
  package.json            # root scripts: build client, start server
  render.yaml             # (ทางเลือก) Render blueprint
  README.md
  PLAN.md                 # ไฟล์นี้

  server/
    index.js              # bootstrap Express + Socket.IO, เสิร์ฟ client/dist
    config.js             # ค่าคงที่ (blinds, action timeout, ฯลฯ)
    rooms.js              # RoomManager: สร้าง/เข้าร่วม/ออก, gen เลขห้อง 4 หลัก
    socket/
      handlers.js         # ผูก socket events -> เรียกเข้า engine/rooms
      stateView.js        # สร้าง state เฉพาะรายผู้เล่น (ซ่อนไพ่คนอื่น)
    game/
      engine.js           # GameEngine: game loop, streets, betting, pots
      table.js            # Table state: ที่นั่ง, ปุ่ม dealer, ตาเดิน
      deck.js             # สร้าง/สับ/แจกไพ่ (ใช้ crypto RNG)
      pot.js              # คำนวณ main pot + side pots ตอน all-in
      handEvaluator.js    # ประเมินไพ่ (ดู §4.3)
      bots.js             # ตรรกะการตัดสินใจของบอท
      variants/
        index.js          # registry: รวมทุก variant + ฟังก์ชัน list()
        texasHoldem.js
        plo.js            # (Phase 3)
    tests/
      handEvaluator.test.js
      pot.test.js         # side pot cases — สำคัญมาก

  client/
    index.html
    vite.config.js
    src/
      main.jsx
      App.jsx             # router + ThemeProvider
      socket.js           # socket.io-client singleton
      store/
        useGameStore.js   # Zustand: state เกม/ห้อง/หน้าจอ
        useProfile.js     # อ่าน/เขียน localStorage profiles
      i18n/
        th.js             # ข้อความไทยทั้งหมดรวมไว้ที่เดียว (แก้ง่าย)
      screens/
        Home.jsx
        HowToPlay.jsx
        ThemeSettings.jsx
        SelectVariant.jsx
        SelectMode.jsx
        BotSetup.jsx
        CreateRoom.jsx
        JoinRoom.jsx
        Lobby.jsx
        Table.jsx
      components/
        AvatarUpload.jsx      # อัพโหลด + crop สี่เหลี่ยมจัตุรัส
        DefaultAvatar.jsx     # สติ๊กแมน SVG (มีหลายแบบให้สุ่ม/เลือก)
        Seat.jsx              # ที่นั่ง 1 ที่ (รูป, ชื่อ, ชิพ, เดิมพัน, สถานะ)
        Card.jsx              # ไพ่ 1 ใบ (หน้า/หลัง, อนิเมชันพลิก)
        CommunityCards.jsx
        BettingControls.jsx   # Fold/Check/Call/Raise + slider + all-in
        PotDisplay.jsx
        Chat.jsx              # (Phase 2)
        QuickChat.jsx         # (Phase 2)
        PauseMenu.jsx         # (โหมดบอท) เล่นต่อ/ออกจากห้อง
        ThemeProvider.jsx
        SoundManager.js       # เล่นเสียง + ปุ่ม mute
      themes/
        themes.css            # CSS variables ต่อธีม (data-theme)
      assets/
        sounds/               # ไฟล์เสียง (CC0) หรือใช้ Web Audio สังเคราะห์
        avatars/              # สติ๊กแมน SVG หลายแบบ
```

**หมายเหตุ:** ใช้ **Zustand** เป็น state store (เบา ใช้ง่าย), **React Router** สำหรับสลับหน้าจอ, **Vitest** สำหรับเทสฝั่ง server

---

## 3. Flow หน้าจอ (ตามลำดับที่ผู้ใช้ระบุ)

### 3.1 Home (`Home.jsx`)
- โลโก้/ชื่อเกมใหญ่ๆ กลางบน: **"PokerGame"**
- ช่องกรอก **ชื่อผู้เล่น**
  - ดึงชื่อที่เคยใช้จาก localStorage มาแสดงเป็นชิป/ดรอปดาวน์ให้กดเลือกเร็ว
- **อัพโหลดรูปโปรไฟล์** (component `AvatarUpload`, ดู §10)
  - ครอปเป็นสี่เหลี่ยมจัตุรัส คัสตอมกรอบได้ (เลื่อน/ซูม)
  - ถ้าไม่อัพโหลด → ใช้ `DefaultAvatar` (สติ๊กแมน SVG)
- ปุ่มหลัก 3 ปุ่ม:
  1. **เริ่มเกม** → ไป `SelectVariant` (validate ว่ากรอกชื่อแล้ว)
  2. **วิธีเล่น** → ไป `HowToPlay`
  3. **ปรับแต่งธีม** → ไป `ThemeSettings`
- เมื่อกรอกชื่อ/ตั้งรูปเสร็จ → บันทึกลง localStorage profiles

### 3.2 วิธีเล่น (`HowToPlay.jsx`)
- อธิบายวิธีเล่นโป๊กเกอร์ (Texas Hold'em; PLO เพิ่มใน Phase 3)
- **ลำดับความแรงของไพ่ สูง → ต่ำ** (แสดงพร้อมตัวอย่างไพ่):
  1. Royal Flush (รอยัลฟลัช)
  2. Straight Flush (สเตรตฟลัช)
  3. Four of a Kind (โฟร์การ์ด / สี่ใบเหมือน)
  4. Full House (ฟูลเฮาส์)
  5. Flush (ฟลัช / สีเดียวกัน 5 ใบ)
  6. Straight (สเตรต / เรียง 5 ใบ)
  7. Three of a Kind (ตอง / สามใบเหมือน)
  8. Two Pair (ทูแพร์ / สองคู่)
  9. One Pair (วันแพร์ / หนึ่งคู่)
  10. High Card (ไฮการ์ด / ไพ่สูง)
- อธิบายศัพท์: บลายด์, ปุ่ม dealer, Fold/Check/Call/Raise/All-in, pot, side pot สั้นๆ
- ปุ่มย้อนกลับ

### 3.3 ปรับแต่งธีม (`ThemeSettings.jsx`)
- เลือกได้ 5 ธีม (ดู §9) แสดงตัวอย่างสีย่อ + กดสลับได้ทันที
- บันทึกธีมที่เลือกลง localStorage (`pokergame:theme`)

### 3.4 เลือกประเภทเกม (`SelectVariant.jsx`)
- แสดงรายการจาก **variant registry** อัตโนมัติ (เพิ่ม variant ใหม่แล้วโผล่เอง):
  - **โป๊กเกอร์ปกติ (Texas Hold'em)** — แจก 2 ใบ
  - **PLO (Pot-Limit Omaha)** — แจก 4 ใบ *(Phase 3; Phase 1-2 แสดงเป็น "เร็วๆ นี้")*
  - **โป๊กเกอร์อื่นๆ** — การ์ด placeholder "กำลังจะมา" (ยังกดเล่นไม่ได้)
- ปุ่มย้อนกลับ

### 3.5 เลือกโหมด (`SelectMode.jsx`)
- **เล่นกับบอท** → `BotSetup`
- **เล่นกับผู้เล่นอื่น** → หน้าเลือก สร้างห้อง / เข้าร่วมห้อง
- ปุ่มย้อนกลับ

### 3.6 ตั้งค่าเล่นกับบอท (`BotSetup.jsx`)
- ตั้ง **จำนวนผู้เล่น** (2–9) → ที่เหลือเติมด้วยบอทอัตโนมัติ
- ตั้ง **ชิพเริ่มต้น** (ค่า default เช่น 1000; กำหนดเองได้)
- (แสดงบลายด์ที่จะใช้ เช่น SB/BB = 10/20 คำนวณจากชิพเริ่มต้น)
- กดเริ่ม → เซิร์ฟเวอร์สร้างห้องภายใน (มนุษย์ 1 + บอท N-1), **สุ่มลำดับที่นั่ง**, เข้าหน้า `Table`

### 3.7 เล่นกับผู้เล่นอื่น
**สร้างห้อง (`CreateRoom.jsx`)**
- ตั้งจำนวนผู้เล่น, เลือกประเภทเกม, ตั้งชิพเริ่มต้น
- กด "สร้างห้อง" → เซิร์ฟเวอร์ gen **เลขห้อง 4 หลัก** (unique) → เข้าหน้า `Lobby`

**เข้าร่วมห้อง (`JoinRoom.jsx`)**
- กรอกเลขห้อง 4 หลัก → เข้าหน้า `Lobby`
- ถ้าเลขผิด/ห้องเต็ม/เกมเริ่มไปแล้ว → แจ้ง error

**ห้องรอ (`Lobby.jsx`)**
- แสดง **รายชื่อสมาชิก** (รูป + ชื่อ) แบบเรียลไทม์
- แสดงเลขห้อง 4 หลัก (ปุ่มก็อปปี้)
- เจ้าของห้อง (host) เท่านั้น: แก้ **จำนวนผู้เล่นสูงสุด**ได้, ปุ่ม **"เพิ่มบอท"** (กด 1 ที = +1 บอท), ปุ่ม **"เริ่มเกม"**
- เริ่มเกม → เซิร์ฟเวอร์ **สุ่มลำดับที่นั่ง** → ทุกคนเข้าหน้า `Table`

### 3.8 โต๊ะเล่น (`Table.jsx`) — ดู §5 สำหรับดีไซน์
- โหมดบอท: มี **ปุ่มหยุด** (`PauseMenu`) → เล่นต่อ / ออกจากห้อง — **ไม่มีแชท**
- โหมดผู้เล่นอื่น: มี **แชท + ควิกแชท** — **ไม่มีปุ่มหยุด** (ออกโดยรีเฟรช/ปิดเว็บ)

---

## 4. Poker Engine — ระบบ Variant ที่ต่อยอดง่าย

### 4.1 หัวใจ: Variant descriptor
เพิ่มเกมรูปแบบใหม่ = สร้างไฟล์ใน `variants/` + register 1 บรรทัด แล้วมันจะโผล่ในหน้าเลือกเกมเอง

```js
// server/game/variants/texasHoldem.js
export default {
  id: 'texas-holdem',
  name: 'โป๊กเกอร์ปกติ (Texas Hold\'em)',
  holeCards: 2,               // จำนวนไพ่แจกให้ผู้เล่น
  boardCards: 5,              // ไพ่กลาง (community)
  holeCardsUsed: null,        // null = ใช้กี่ใบก็ได้ (best 5 จาก 7)
  bettingStructure: 'no-limit',
  streets: [                  // ลำดับการแจก/รอบเดิมพัน
    { name: 'preflop', dealToBoard: 0 },
    { name: 'flop',    dealToBoard: 3 },
    { name: 'turn',    dealToBoard: 1 },
    { name: 'river',   dealToBoard: 1 },
  ],
};
```

```js
// server/game/variants/plo.js  (Phase 3)
export default {
  id: 'plo',
  name: 'PLO (Pot-Limit Omaha)',
  holeCards: 4,
  boardCards: 5,
  holeCardsUsed: { exactly: 2 },   // ต้องใช้ไพ่ในมือ 2 ใบพอดี
  bettingStructure: 'pot-limit',
  streets: [ /* เหมือน Hold'em */ ],
};
```

```js
// server/game/variants/index.js
import texasHoldem from './texasHoldem.js';
import plo from './plo.js';
const registry = new Map([
  [texasHoldem.id, texasHoldem],
  // [plo.id, plo],   // เปิดใน Phase 3
]);
export const getVariant = (id) => registry.get(id);
export const listVariants = () => [...registry.values()]
  .map(v => ({ id: v.id, name: v.name, holeCards: v.holeCards }));
```

> **GameEngine อ่านค่าจาก descriptor** (holeCards, streets, bettingStructure, holeCardsUsed) แทนที่จะ hardcode กติกา Hold'em → รองรับ variant ใหม่โดยไม่แก้ engine

### 4.2 Deck (`deck.js`)
- 52 ใบ (rank 2..A × suit ♣♦♥♠)
- สับด้วย **`crypto.randomInt`** (Fisher–Yates) เพื่อความแฟร์ ไม่ใช้ `Math.random`
- แจกตาม descriptor: holeCards ต่อผู้เล่น + board ตาม streets

### 4.3 Hand Evaluator (`handEvaluator.js`)
- ใช้ไลบรารี **`pokersolver`** สำหรับประเมิน 5 ใบที่ดีที่สุด
- **Hold'em:** ส่ง hole(2) + board(5) = 7 ใบ ให้ solver เลือก best-5 เอง
- **PLO:** ต้องใช้ hole **2 ใบพอดี** + board 3 ใบ → generate ทุกคอมบิเนชัน `C(4,2)=6 × C(5,3)=10 = 60` มือ แล้วเลือกมือที่ดีที่สุดด้วย solver (วิธีมาตรฐานที่ถูกต้องเสมอ ไม่ขึ้นกับไลบรารี)
- Interface กลาง: `evaluate(holeCards, board, variant) -> { rankValue, name, bestFive }` ให้ engine เอาไปเทียบ + จัดการ **split pot** (เสมอ) ได้
- **มีเทสครอบ** (`tests/handEvaluator.test.js`): royal flush, กันไม้ตาย straight (A-2-3-4-5 / 10-J-Q-K-A), เทียบ kicker, split pot, และเคส PLO ที่ต้องใช้ 2 ใบพอดี

---

## 5. กติกาการเดิมพัน + Game Loop (แบบไม่มีดีลเลอร์ / Triton style)

### 5.1 กติกา (Cash game, บลายด์คงที่, ชิพหมด = ตกรอบ)
- **ไม่มีผู้เล่นดีลเลอร์** — เซิร์ฟเวอร์แจกไพ่เอง มี **ปุ่ม dealer (button)** หมุนตามเข็มทุกมือ
- **Blinds:** Small Blind (SB) + Big Blind (BB) โพสต์อัตโนมัติ (ค่าเริ่มต้นคงที่ทั้งเกม)
- **ลำดับ street:** preflop → flop → turn → river → showdown
- **Action:** Fold / Check / Call / Bet / Raise / All-in
  - preflop: เริ่มเดินซ้ายมือ BB; postflop: เริ่มซ้ายมือปุ่ม
  - **min-raise** = ขนาด raise ก่อนหน้า (อย่างน้อย = BB)
  - **No-Limit** (Hold'em): raise สูงสุด = ชิพทั้งหมด (all-in)
  - **Pot-Limit** (PLO): raise สูงสุด = ขนาด pot (คำนวณ pot-limit ให้ถูก: call ก่อนแล้วบวก pot)
- **All-in → side pots:** คำนวณ main pot + side pots ให้ถูกต้อง (`pot.js`) — จุดนี้ต้องมีเทส
- **Showdown:** ประเมินมือ, แจก pot (รวม split เมื่อเสมอ), ผู้ชนะ pot ไหนได้ pot นั้น
- **หลังจบมือ:** ผู้เล่นที่ชิพเหลือ 0 = **ตกรอบ** (เอาออกจากโต๊ะ) เล่นต่อจนเหลือ 1 คน = จบเกม
- **Heads-up (เหลือ 2 คน):** ปุ่ม = SB (กติกาพิเศษ) — จัดการให้ถูก
- ระบุ **action timeout** (เช่น 20–30 วิ) ถ้าหมดเวลา: check ถ้าได้ ไม่งั้น fold (กันเกมค้าง โดยเฉพาะโหมดผู้เล่นจริง)

### 5.2 ดีไซน์โต๊ะ (ฝ่ายพัฒนาจัดให้สวย — ผู้ใช้ยกให้ตัดสินใจ)
- โต๊ะรูปวงรี ที่นั่งกระจายรอบขอบ (รองรับ 2–9 ที่) — ผู้เล่นตัวเอง**อยู่ล่างสุดเสมอ** (หมุนมุมมองให้ตัวเองอยู่ข้างล่าง)
- แต่ละที่นั่ง (`Seat`): รูปโปรไฟล์, ชื่อ, ชิพคงเหลือ, ชิปที่เดิมพันรอบนี้ (วางหน้าที่นั่ง), ป้ายสถานะ (Dealer/SB/BB/กำลังคิด/Fold/All-in), แถบ timer ตอนถึงตา
- ไพ่กลาง (`CommunityCards`) + **pot รวม** กลางโต๊ะ (`PotDisplay`)
- ไพ่ในมือตัวเองเปิดเห็น, ของคนอื่นเป็นหลังไพ่จนถึง showdown
- `BettingControls`: ปุ่ม Fold / Check-or-Call (label เปลี่ยนตามสถานการณ์) / Raise + slider + ปุ่มลัด (1/2 pot, pot, all-in) — โผล่เฉพาะตอนถึงตาเรา
- อนิเมชัน: แจกไพ่, พลิกไพ่กลาง, ดันชิปเข้า pot, กวาด pot ให้ผู้ชนะ (พร้อมเสียง §11)

### 5.3 State machine ของ engine
`WAITING → DEALING → BETTING(street) → ...(วนจนครบ street)... → SHOWDOWN → PAYOUT → (ตกรอบ?) → NEXT_HAND / GAME_OVER`
(โหมดบอท: แทรกสถานะ `PAUSED` ได้)

---

## 6. บอท (`bots.js`)

- ตรรกะ heuristic ระดับ "พอสมเหตุสมผล" (ยังไม่ต้องฉลาดมาก):
  - **preflop:** ประเมินความแรงไพ่ในมือ (เช่น Chen formula หรือ lookup ตาราง) + ตำแหน่ง
  - **postflop:** ประเมินมือปัจจุบัน + outs คร่าวๆ + pot odds
  - ใส่ค่าสุ่มเล็กน้อยเพื่อ bluff/หลอก ให้ไม่คาดเดาง่าย
  - ตัดสินใจ fold/call/raise ตามความแรง + pot odds
- บอทเดินโดยมี **หน่วงเวลา** (เช่น 0.8–2 วิ) ให้ดูเป็นธรรมชาติ
- ออกแบบเป็นฟังก์ชัน `decideAction(botState, tableState, variant) -> { action, amount }` เพื่อ **สลับ/อัพเกรดระดับความยากได้ในอนาคต** (โน้ตไว้: easy/normal/hard)

---

## 7. Multiplayer — ห้อง + Socket.IO

### 7.1 RoomManager (`rooms.js`)
- `createRoom({ hostId, variantId, maxPlayers, startingChips })` → gen **เลข 4 หลักไม่ซ้ำ**, เก็บใน Map
- `joinRoom(code, player)` → เช็คห้องมีจริง/ไม่เต็ม/ยังไม่เริ่ม
- `addBot(code)` → เพิ่มบอทเข้า lobby (host เท่านั้น)
- `updateConfig(code, { maxPlayers })` → host แก้จำนวนผู้เล่น
- `startGame(code)` → **สุ่มลำดับที่นั่ง** แล้วส่งต่อให้ GameEngine
- `leaveRoom` / จัดการ disconnect (ดู §7.3)
- ห้องว่าง (ไม่มีมนุษย์เหลือ) → เก็บกวาดทิ้ง (กัน memory leak)

### 7.2 Socket.IO event contract

**Client → Server**
| event | payload | หมายเหตุ |
|---|---|---|
| `profile:set` | `{ name, avatar }` | ตั้งตัวตนหลัง connect |
| `bots:start` | `{ variantId, numPlayers, startingChips }` | เริ่มโหมดบอท |
| `room:create` | `{ variantId, maxPlayers, startingChips }` | → ตอบ `room:created {code}` |
| `room:join` | `{ code }` | |
| `room:updateConfig` | `{ maxPlayers }` | host เท่านั้น |
| `room:addBot` | `{}` | host เท่านั้น |
| `room:start` | `{}` | host เท่านั้น |
| `game:action` | `{ action, amount }` | action ∈ fold/check/call/bet/raise/allin |
| `game:pause` / `game:resume` / `game:leave` | `{}` | โหมดบอทเท่านั้น |
| `chat:message` | `{ text }` | โหมดผู้เล่นเท่านั้น |
| `chat:quick` | `{ presetId }` | ควิกแชท |

**Server → Client**
| event | payload | หมายเหตุ |
|---|---|---|
| `room:created` | `{ code }` | |
| `lobby:state` | `{ code, players[], maxPlayers, hostId, variant }` | อัพเดตเรียลไทม์ |
| `game:state` | **filtered per player** (ดู §7.4) | ทุกครั้งที่ state เปลี่ยน |
| `game:yourTurn` | `{ options, minRaise, maxRaise, timeLeft }` | |
| `game:showdown` | `{ reveals[], winners[], pots[] }` | เปิดไพ่ที่ต้องเปิด |
| `game:handEnd` / `game:over` | `{ eliminated[], winnerId? }` | |
| `chat:message` | `{ fromId, name, text, ts }` | |
| `error` | `{ code, message }` | ข้อความ error เป็นไทย |

### 7.3 ผู้เล่นออกกลางเกม (โหมดผู้เล่นจริง)
- ออก = **รีเฟรช/ปิดเว็บ** → เซิร์ฟเวอร์จับ `disconnect`
- เมื่อออก: **ลบชิพที่เหลือของผู้เล่นนั้นทิ้ง เหลือเฉพาะชิพที่ลงเดิมพันไว้ใน pot บนโต๊ะแล้ว** (ชิพใน pot ยังอยู่ให้ชิงกันต่อ)
- ถ้ากำลังเป็นตาเขา → ถือว่า fold (แต่ชิพที่ลงไปแล้วอยู่ใน pot)
- เกมเดินต่อกับผู้เล่นที่เหลือ; ถ้าเหลือมนุษย์ 0 คน → ปิดห้อง
- **ไม่มีระบบ reconnect** (ตามที่ตกลง: รีเฟรช = ออก) → ทำให้โค้ดเรียบง่าย

### 7.4 stateView (`stateView.js`) — กันโกง
- ก่อน emit `game:state` ให้แต่ละ socket: **ตัดไพ่ในมือของผู้เล่นคนอื่นออก** (ส่งแค่ "มีไพ่/หลังไพ่")
- ส่งไพ่จริงของคนอื่นเฉพาะตอน `game:showdown` และเฉพาะมือที่ต้องเปิดตามกติกา

---

## 8. แชท (Phase 2, โหมดผู้เล่นจริงเท่านั้น)

- `Chat.jsx`: กล่องแชทเรียลไทม์ (ชื่อ + ข้อความ + เวลา) — จำกัดความยาว, กัน spam เบื้องต้น
- `QuickChat.jsx`: ปุ่มลัดข้อความสำเร็จรูปภาษาไทย เช่น
  - "โชคดีนะ!", "เล่นดีมาก", "ออลอินเลย!", "รอแป๊บ", "ขอบคุณ", "555", "เอาจริงดิ", "ยอมแล้ว"
- **โหมดบอทไม่มีแชท**

---

## 9. ธีม (5 ธีม) — `themes/themes.css`

ทำด้วย **CSS variables** สลับผ่าน `data-theme` บน `<html>` (เก็บใน localStorage):

| ธีม | โทน |
|---|---|
| **ปกติ (Classic)** | โทนสว่าง สะอาดตา โต๊ะเขียวอ่อน/ครีม |
| **มืด (Dark)** | พื้นเข้ม ตัวอักษรสว่าง สบายตากลางคืน |
| **ญี่ปุ่น (Japanese)** | ซากุระชมพู–แดง–ขาว ลายวาชิ ฟอนต์มีกลิ่นญี่ปุ่น |
| **Casino Green** | สักหลาดเขียวเข้ม + ทอง หรูแบบคาสิโน |
| **นีออน (Neon Night)** *(ธีมที่ 5 ที่ผู้พัฒนาเลือกเอง)* | ไซเบอร์พังก์ ม่วง/ฟ้า/ชมพูนีออน เรืองแสง |

- ทุก component ใช้ตัวแปร (เช่น `--bg`, `--surface`, `--felt`, `--text`, `--accent`, `--card-bg`) → เพิ่มธีมใหม่ = เพิ่มบล็อกตัวแปรชุดเดียว

---

## 10. อัพโหลด + ครอปรูป (`AvatarUpload.jsx`)

- อัพโหลดรูป → ครอปเป็น **สี่เหลี่ยมจัตุรัส** ปรับกรอบเองได้ (เลื่อน + ซูม)
- ใช้ไลบรารี **`react-easy-crop`** (เบา, ครอปสี่เหลี่ยมจัตุรัสได้ดี) แล้ว export เป็น dataURL (resize เช่น 256×256, บีบเป็น JPEG/WebP กันไฟล์ใหญ่)
- เก็บ dataURL คู่กับชื่อใน localStorage profile
- **รูป default:** ชุดสติ๊กแมน SVG หลายแบบใน `assets/avatars/` (`DefaultAvatar.jsx` เลือก/สุ่มให้) ถ้าไม่อัพโหลด
- ขนาด dataURL ที่เก็บควรเล็ก (< ~50KB) เพราะต้องส่งผ่าน socket ให้คนอื่นเห็นด้วย

---

## 11. เสียง (`SoundManager.js`)

- จุดที่ควรมีเสียง: แจกไพ่, **พลิกไพ่กลาง (เปิดไพ่)**, ดันชิป/เดิมพัน, check (เคาะโต๊ะ), fold, ถึงตาเรา (เตือน), ชนะ pot (กวาดชิป), กดปุ่ม UI
- มี **ปุ่ม mute** + จำสถานะใน localStorage; เริ่มเสียงหลัง user interaction (นโยบาย autoplay ของเบราว์เซอร์)
- แหล่งเสียง: ไฟล์ CC0/รอยัลตี้ฟรีขนาดเล็ก **หรือ** สังเคราะห์ด้วย Web Audio API (เลี่ยงปัญหาลิขสิทธิ์/ขนาดไฟล์) — ผู้พัฒนาเลือกตามสะดวก

---

## 12. ข้อมูลฝั่ง client (localStorage)

| key | ค่า |
|---|---|
| `pokergame:profiles` | `[{ name, avatar(dataURL) }]` — ชื่อที่เคยใช้ + รูป |
| `pokergame:lastProfile` | ชื่อที่ใช้ล่าสุด |
| `pokergame:theme` | id ธีมที่เลือก |
| `pokergame:muted` | boolean |

---

## 13. Deploy บน Render (free tier)

- **หนึ่ง Web Service** (Node). Build: `npm run build` (build React → `client/dist`). Start: `node server/index.js`
- Server เสิร์ฟ `client/dist` เป็น static + Socket.IO บนพอร์ตเดียว (`process.env.PORT`)
- **ข้อจำกัด free tier ที่ต้องรู้ (ใส่หมายเหตุใน README):**
  - Service **สปินดาวน์หลังไม่มีทราฟฟิก ~15 นาที** → คำขอแรกหลังหลับ cold start ~30–50 วิ
  - **State อยู่ใน memory** → ถ้า service รีสตาร์ท/สปินดาวน์ ห้องที่ค้างอยู่จะหาย (ยอมรับได้สำหรับเล่นชิลๆ)
  - RAM ~512MB, CPU น้อย — instance เดียว รองรับ ≤ 50 คนสบาย
  - instance เดียว → **ไม่ต้องทำ sticky session / Redis adapter** สำหรับ Socket.IO
- ใส่ `render.yaml` (blueprint) ให้ deploy ง่าย + ระบุ `node` version ใน `package.json` engines

---

## 14. แผนแบ่งเฟส + เกณฑ์ผ่าน (Acceptance criteria)

### Phase 1 — Texas Hold'em เล่นกับบอท (แกนหลักให้ครบก่อน)
ขอบเขต: Home (ชื่อ + อัพโหลด/ครอปรูป + localStorage), ระบบธีมครบ 5 ธีม, หน้าวิธีเล่น (พร้อมลำดับไพ่), เลือกเกม (registry), เลือกโหมด, ตั้งค่าบอท, **เอนจิน Hold'em เต็ม** (บลายด์, ปุ่มหมุน, betting no-limit, all-in + side pots, showdown, ตกรอบ), หน้า Table + ดีไซน์โต๊ะ + betting controls, บอท, เสียง, ปุ่มหยุด (เล่นต่อ/ออก), server-authoritative
- ✅ เล่น Hold'em กับบอทจนจบเกม (เหลือคนเดียว) ได้จริง ไม่มีบั๊กตาเดิน
- ✅ all-in แล้วแบ่ง side pot ถูกต้อง (มีเทสผ่าน)
- ✅ สุ่มที่นั่งเริ่มต้น, ชิพหมด = ตกรอบ
- ✅ 5 ธีมสลับได้, อัพโหลด+ครอปรูปได้, จำชื่อเดิมได้, มีเสียง, ปุ่มหยุดทำงาน

### Phase 2 — เล่นกับผู้เล่นอื่น (Multiplayer)
ขอบเขต: สร้างห้อง (เลข 4 หลัก), เข้าร่วมห้อง, Lobby (รายชื่อเรียลไทม์, host แก้จำนวน/เพิ่มบอท/เริ่ม), โต๊ะมัลติเพลเยอร์เรียลไทม์ (reuse engine เฟส 1), **แชท + ควิกแชท**, จัดการผู้เล่นออก (ลบชิพเหลือเฉพาะที่ลง pot), stateView กันโกง
- ✅ 2+ เบราว์เซอร์เข้าห้องเดียวกันด้วยเลข 4 หลัก เล่นพร้อมกันได้
- ✅ host เพิ่มบอท/แก้จำนวน/เริ่มเกมได้; ไพ่คนอื่นไม่รั่วไป client
- ✅ แชท/ควิกแชททำงาน (และโหมดนี้ไม่มีปุ่มหยุด)
- ✅ ผู้เล่นรีเฟรช/ปิดเว็บ → ชิพหายเหลือเฉพาะที่ลง pot, เกมเดินต่อได้

### Phase 3 — PLO + ขัดเกลา + Deploy
ขอบเขต: เปิด variant **PLO** (แจก 4 ใบ, pot-limit, ประเมินแบบ Omaha ใช้ 2 ใบพอดี), การ์ด "โป๊กเกอร์อื่นๆ" placeholder, ปรับธีม/อนิเมชัน/เสียงให้เนียน, ตั้งค่า Render (`render.yaml` + README), ทดสอบโหลด/แก้บั๊ก
- ✅ เล่น PLO ได้ถูกกติกา (บังคับใช้ไพ่ในมือ 2 ใบ, pot-limit ถูกต้อง, มีเทส)
- ✅ deploy ขึ้น Render แล้วเล่นได้จริงจากอินเทอร์เน็ต
- ✅ เพิ่ม variant ใหม่ได้โดยแตะแค่โฟลเดอร์ `variants/` (พิสูจน์ด้วย PLO)

---

## 15. ข้อควรระวัง / Edge cases ที่ต้องจัดการ

- **Side pots หลายชั้น** ตอนหลายคน all-in ด้วยชิพต่างกัน — จุดบั๊กบ่อยที่สุด ต้องมีเทส
- **Split pot** (เสมอ) แบ่งชิพลงตัว/เศษ, มอบเศษให้ผู้เล่นใกล้ปุ่มตามธรรมเนียม
- Straight พิเศษ: A-2-3-4-5 (ต่ำสุด) และ 10-J-Q-K-A (สูงสุด)
- **Heads-up blinds** (ปุ่มเป็น SB)
- ทุกคน check/all-in ครบ → ไปstreet ถัดไป/showdown อัตโนมัติ
- ผู้เล่นเหลือ 1 คนที่ยังไม่ fold → ชนะทันทีไม่ต้องเปิดไพ่
- **Action timeout** กันเกมค้างเมื่อคนหาย/ไม่กด
- validate action ทุกครั้งฝั่ง server (จำนวน raise, ถึงตาจริงไหม, มีชิพพอไหม) — อย่าเชื่อ client
- gen เลขห้อง 4 หลัก **ไม่ซ้ำ** และ retry ถ้าชน
- ขนาด avatar dataURL ต้องเล็กก่อนส่งผ่าน socket (กัน payload ใหญ่)

---

## 16. อนาคต (ออกแบบเผื่อไว้ ไม่ต้องทำตอนนี้)

- variant เพิ่มเติม (Short Deck, Seven-Card Stud ฯลฯ) ผ่าน registry เดิม
- ระดับความยากบอท (easy/normal/hard)
- reconnect กลับห้องเดิม (ถ้าอยากยกเลิกกติกา "รีเฟรช = ออก")
- ประวัติมือ/สถิติ, ระบบเสียงเอฟเฟกต์เพิ่ม, emoji reactions
- ถ้าผู้เล่นเกิน 50 หรืออยากได้ persistent → ย้าย state ไป Redis + Socket.IO adapter

---

### สรุปสำหรับผู้พัฒนา
เริ่มที่ **Phase 1** ให้ Hold'em vs บอทเล่นได้จบเกมจริงก่อน (โฟกัสความถูกต้องของ betting/side pot + โครง variant registry + stateView ตั้งแต่แรกแม้ยังไม่ถึงมัลติเพลเยอร์) แล้วค่อยต่อ Phase 2 (มัลติเพลเยอร์/แชท) และ Phase 3 (PLO/deploy) โดย **reuse เอนจินเดิม** ทั้งหมด
```
