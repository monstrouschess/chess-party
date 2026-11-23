// Chess Party server: serves the website and relays party games over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Chess } from 'chess.js';
import { resultOf, CODE_CHARS, CODE_LEN } from './public/shared.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = process.env.PORT || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let file;
  if (url === '/lib/chess.js') file = path.join(ROOT, 'node_modules/chess.js/dist/esm/chess.js');
  else {
    if (url === '/') url = '/index.html';
    file = path.join(PUBLIC, path.normalize(url));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    // The chess engine is big and never changes, so let browsers keep it for a week.
    const cache = url.startsWith('/engine/') ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
});

// ---- Parties ----
const rooms = new Map(); // code -> room
const other = (c) => (c === 'w' ? 'b' : 'w');

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LEN; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

function newRoom() {
  const room = {
    code: newCode(), seats: { w: null, b: null }, socks: { w: null, b: null },
    chess: new Chess(), moves: [], result: null, rematch: new Set(), gameNo: 1, lastSeen: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function stateFor(room, color) {
  const o = other(color);
  return {
    type: 'state', code: room.code, color, moves: room.moves, result: room.result, gameNo: room.gameNo,
    oppSeated: !!room.seats[o], oppHere: !!room.socks[o],
    rematch: { me: room.rematch.has(color), them: room.rematch.has(o) },
  };
}

function broadcast(room) {
  for (const c of ['w', 'b']) send(room.socks[c], stateFor(room, c));
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function seat(ws, room, color, token) {
  const old = room.socks[color];
  if (old && old !== ws) { old.room = null; send(old, { type: 'error', msg: 'You opened this party in another tab.', fatal: true }); old.close(); }
  room.seats[color] = token;
  room.socks[color] = ws;
  ws.room = room; ws.color = color;
  room.lastSeen = Date.now();
  broadcast(room);
}

function detach(ws) {
  const room = ws.room;
  if (!room) return;
  if (room.socks[ws.color] === ws) room.socks[ws.color] = null;
  ws.room = null;
  room.lastSeen = Date.now();
  broadcast(room);
}

function handle(ws, msg) {
  const room = ws.room;
  switch (msg.type) {
    case 'create': {
      detach(ws);
      const r = newRoom();
      seat(ws, r, Math.random() < 0.5 ? 'w' : 'b', String(msg.token));
      break;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const r = rooms.get(code);
      if (!r) return send(ws, { type: 'error', msg: `No party found with code ${code || '(empty)'}.`, fatal: true });
      const token = String(msg.token);
      let color = ['w', 'b'].find((c) => r.seats[c] === token);
      if (!color) color = ['w', 'b'].find((c) => !r.seats[c]);
      if (!color) return send(ws, { type: 'error', msg: 'That party is already full.', fatal: true });
      if (ws.room && ws.room !== r) detach(ws);
      seat(ws, r, color, token);
      break;
    }
    case 'move': {
      if (!room || room.result || !room.seats.w || !room.seats.b) return;
      if (room.chess.turn() !== ws.color) return send(ws, stateFor(room, ws.color));
      let mv;
      try { mv = room.chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion }); } catch { mv = null; }
      if (!mv) return send(ws, stateFor(room, ws.color));
      room.moves.push({ from: mv.from, to: mv.to, promotion: mv.promotion, san: mv.san });
      room.result = resultOf(room.chess);
      broadcast(room);
      break;
    }
    case 'resign': {
      if (!room || room.result || !room.seats[other(ws.color)]) return;
      room.result = { winner: other(ws.color), reason: 'resignation' };
      broadcast(room);
      break;
    }
    case 'rematch': {
      if (!room || !room.result) return;
      room.rematch.add(ws.color);
      if (room.rematch.size === 2) {
        // Swap colours for the next game.
        room.seats = { w: room.seats.b, b: room.seats.w };
        room.socks = { w: room.socks.b, b: room.socks.w };
        for (const c of ['w', 'b']) if (room.socks[c]) room.socks[c].color = c;
        room.chess = new Chess(); room.moves = []; room.result = null; room.rematch.clear(); room.gameNo++;
      }
      broadcast(room);
      break;
    }
    case 'leave': {
      if (!room) return;
      const c = ws.color;
      if (!room.result && room.moves.length > 0 && room.seats[other(c)]) room.result = { winner: other(c), reason: 'opponent left' };
      room.seats[c] = null; room.rematch.clear();
      detach(ws);
      if (!room.seats.w && !room.seats.b) rooms.delete(room.code);
      break;
    }
  }
}

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    try { handle(ws, msg); } catch (e) { console.error(e); }
  });
  ws.on('close', () => detach(ws));
});

// Keep connections alive (free hosts drop idle sockets) and spot dead ones.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 25000);

// Forget parties nobody has touched for 2 hours.
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [code, r] of rooms) if (!r.socks.w && !r.socks.b && r.lastSeen < cutoff) rooms.delete(code);
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Chess Party running at http://localhost:${PORT}`));
