# PokerGame

โป๊กเกอร์ UI ภาษาไทยทั้งหมด เล่นได้ทั้งกับบอทและมัลติเพลเยอร์จริง — Texas Hold'em, PLO (Pot-Limit Omaha), Choice Poker [Kakegurui], Doubt Poker [Kakegurui]

Stack: Node + Express + Socket.IO (server-authoritative) + React + Vite, รันเป็น service เดียว — ดูรายละเอียดสถาปัตยกรรม/กติกาเต็มๆ ได้ที่ [PLAN.md](./PLAN.md)

## รันตอน dev

```bash
npm install          # ติดตั้งทั้ง client + server (npm workspaces)
npm run dev:server   # ฝั่ง server (พอร์ต 3001, auto-restart)
npm run dev:client   # ฝั่ง client (พอร์ต 5173, Vite dev server)
```

เปิดเบราว์เซอร์ที่ `http://localhost:5173` (client dev server จะ proxy socket ไปหา server พอร์ต 3001 ให้เอง)

## เทส (server)

```bash
npm test
```

## Build + รันแบบ production เดียว

```bash
npm run build   # build client -> client/dist
npm start       # server เสิร์ฟทั้ง static client + Socket.IO บนพอร์ตเดียว (process.env.PORT)
```

## Deploy บน Render (free tier)

โปรเจกต์มี `render.yaml` (Blueprint) พร้อมใช้แล้ว — ที่ Render dashboard เลือก **New → Blueprint** แล้วชี้ไปที่ repo นี้ได้เลย ไม่ต้องตั้งค่าอะไรเพิ่ม

**ข้อจำกัดของ free tier ที่ควรรู้:**
- Service จะ **สปินดาวน์หลังไม่มีทราฟฟิกประมาณ 15 นาที** — คำขอแรกหลังตื่นจะช้า (cold start ~30-50 วินาที)
- **State ของห้อง/เกมทั้งหมดอยู่ใน memory** ไม่มี database — ถ้า service restart หรือสปินดาวน์ ห้องที่ค้างอยู่จะหายหมด (ยอมรับได้สำหรับเล่นชิลๆ ไม่เหมาะกับทัวร์นาเมนต์จริงจัง)
- 1 instance เดียว รองรับผู้เล่นพร้อมกันได้สบายในหลักสิบคน — ถ้าจะรองรับมากกว่านั้นหรืออยากได้ persistent state ต้องย้ายไป Redis + Socket.IO adapter (ดู PLAN.md §16)

## ตัวแปรสภาพแวดล้อม (environment variables)

| ตัวแปร | ใช้ทำอะไร | ค่า default |
|---|---|---|
| `PORT` | พอร์ตที่ server ฟัง (Render ตั้งให้อัตโนมัติ) | `3001` |
| `DEBUG_POKER` | เปิด log สถานะห้อง/เกมแบบละเอียด | ปิด |
| `DISCONNECT_GRACE_MS_OVERRIDE` | ปรับเวลารอ reconnect ก่อนถือว่าหลุด (ใช้ตอนเทสเท่านั้น) | `20000` (20 วิ) |
