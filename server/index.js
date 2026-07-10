import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socket/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '../client/dist');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.NODE_ENV === 'production' ? false : '*' },
  // Detect dead connections (closed laptop lid, lost wifi) reasonably fast so
  // a disconnected player's table pauses promptly instead of the bots playing
  // on for tens of seconds against an empty seat.
  pingInterval: 10000,
  pingTimeout: 8000,
});

app.use(express.static(clientDist));
app.get('*', (req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send('PokerGame server is running. Client build not found — run `npm run build`.');
  }
});

registerSocketHandlers(io);

if (process.env.DEBUG_POKER) {
  process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
  });
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`PokerGame server listening on port ${PORT}`);
});
