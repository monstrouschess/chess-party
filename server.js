// Chess Party server: serves the website and relays party games over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Chess } from 'chess.js';
import { resultOf, CODE_CHARS, CODE_LEN, TIME_CONTROLS, DEFAULT_TC, newClock, timeLeft, clockAfterMove, stopClock, timeoutResult, eloDelta, cleanProfile } from './public/shared.js';

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

function newRoom(tc) {
  if (!TIME_CONTROLS.some((t) => t.id === tc)) tc = DEFAULT_TC;
  const room = {
    tc, clock: newClock(tc), flagTimer: null,
    code: newCode(), seats: { w: null, b: null }, socks: { w: null, b: null },
    chess: new Chess(), moves: [], result: null, rematch: new Set(), gameNo: 1, lastSeen: Date.now(),
    chat: [], chatId: 0, // chat: [{ id, by: seat token, text }]
    profiles: {}, // seat token -> { name, rating, games }
    rated: null,  // rating changes for the finished game
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
    tc: room.tc, clock: clockView(room.clock),
    players: { me: room.profiles[room.seats[color]] || null, opp: room.profiles[room.seats[o]] || null },
    rated: room.rated,
  };
}

// Clock as sent to players: "elapsed" lets each browser work out the live time without trusting its own clock.
function clockView(c) {
  if (!c) return null;
  return { base: c.base, inc: c.inc, w: c.w, b: c.b, running: c.running, elapsed: c.running ? Date.now() - c.since : 0 };
}

// End the game for whoever is out of time, and (re)arm a timer for the side now to move.
function checkFlag(room) {
  clearTimeout(room.flagTimer); room.flagTimer = null;
  const c = room.clock;
  if (!c || !c.running || room.result) return false;
  const left = timeLeft(c, c.running, Date.now());
  if (left <= 0) {
    const loser = c.running;
    stopClock(c, Date.now()); c[loser] = 0;
    endGame(room, timeoutResult(room.chess, loser));
    return true;
  }
  room.flagTimer = setTimeout(() => { if (checkFlag(room)) broadcast(room); }, left + 30);
  return false;
}

function endGame(room, result) {
  room.result = result;
  stopClock(room.clock, Date.now());
  clearTimeout(room.flagTimer); room.flagTimer = null;
  rate(room);
}

// Every finished party game is rated (one rating for all time controls).
// Games that end before both players have moved are "aborted" and don't count.
function rate(room) {
  room.rated = null;
  const pw = room.profiles[room.seats.w], pb = room.profiles[room.seats.b];
  if (!pw || !pb || room.moves.length < 2) return;
  const sw = room.result.winner === 'w' ? 1 : room.result.winner === 'b' ? 0 : 0.5;
  const dw = eloDelta(pw.rating, pb.rating, sw, pw.games), db = eloDelta(pb.rating, pw.rating, 1 - sw, pb.games);
  const row = (p, d) => ({ before: p.rating, after: Math.max(100, p.rating + d), delta: Math.max(100, p.rating + d) - p.rating });
  room.rated = { gameNo: room.gameNo, w: row(pw, dw), b: row(pb, db) };
  pw.rating = room.rated.w.after; pw.games++;
  pb.rating = room.rated.b.after; pb.games++;
}

function broadcast(room) {
  for (const c of ['w', 'b']) send(room.socks[c], stateFor(room, c));
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function seat(ws, room, color, token, profile) {
  // First time in this room: take the profile the browser sends. Coming back: keep the server's rating, update the name.
  const p = cleanProfile(profile);
  if (room.profiles[token]) room.profiles[token].name = p.name; else room.profiles[token] = p;
  const old = room.socks[color];
  if (old && old !== ws) { old.room = null; send(old, { type: 'error', msg: 'You opened this party in another tab.', fatal: true }); old.close(); }
  room.seats[color] = token;
  room.socks[color] = ws;
  ws.room = room; ws.color = color;
  room.lastSeen = Date.now();
  broadcast(room);
  send(ws, { type: 'chat', reset: true, msgs: room.chat.map((m) => chatView(m, token)) });
}

const chatView = (m, token) => ({ id: m.id, mine: m.by === token, text: m.text });
const CHAT_MAX = 200, CHAT_KEEP = 100;

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
      const r = newRoom(String(msg.tc || ''));
      seat(ws, r, Math.random() < 0.5 ? 'w' : 'b', String(msg.token), msg.profile);
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
      seat(ws, r, color, token, msg.profile);
      break;
    }
    case 'move': {
      if (!room || room.result || !room.seats.w || !room.seats.b) return;
      if (room.chess.turn() !== ws.color) return send(ws, stateFor(room, ws.color));
      if (checkFlag(room)) return broadcast(room); // too late: their time ran out
      let mv;
      try { mv = room.chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion }); } catch { mv = null; }
      if (!mv) return send(ws, stateFor(room, ws.color));
      room.moves.push({ from: mv.from, to: mv.to, promotion: mv.promotion, san: mv.san });
      clockAfterMove(room.clock, ws.color, room.moves.length, Date.now());
      const res = resultOf(room.chess);
      if (res) endGame(room, res); else checkFlag(room);
      broadcast(room);
      break;
    }
    case 'chat': {
      if (!room || room.socks[ws.color] !== ws) return;
      const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX);
      if (!text) return;
      const now = Date.now();
      if (now - (ws.lastChat || 0) < 350) return; // simple anti-spam
      ws.lastChat = now;
      const m = { id: ++room.chatId, by: room.seats[ws.color], text };
      room.chat.push(m); if (room.chat.length > CHAT_KEEP) room.chat.shift();
      for (const c of ['w', 'b']) send(room.socks[c], { type: 'chat', msgs: [chatView(m, room.seats[c])] });
      break;
    }
    case 'resign': {
      if (!room || room.result || !room.seats[other(ws.color)]) return;
      endGame(room, { winner: other(ws.color), reason: 'resignation' });
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
        room.clock = newClock(room.tc); clearTimeout(room.flagTimer); room.flagTimer = null; room.rated = null;
      }
      broadcast(room);
      break;
    }
    case 'leave': {
      if (!room) return;
      const c = ws.color;
      if (!room.result && room.moves.length > 0 && room.seats[other(c)]) endGame(room, { winner: other(c), reason: 'opponent left' });
      room.seats[c] = null; room.rematch.clear();
      detach(ws);
      if (!room.seats.w && !room.seats.b) { clearTimeout(room.flagTimer); rooms.delete(room.code); }
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
  for (const [code, r] of rooms) if (!r.socks.w && !r.socks.b && r.lastSeen < cutoff) { clearTimeout(r.flagTimer); rooms.delete(code); }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Chess Party running at http://localhost:${PORT}`));
