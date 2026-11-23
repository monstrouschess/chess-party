// Code shared by the browser and the server.

// No O/0 or I/1 so codes are easy to read out loud.
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 5;

// Returns null while the game is still going, otherwise { winner: 'w'|'b'|null, reason }.
export function resultOf(chess) {
  if (chess.isCheckmate()) return { winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficient material' };
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'repetition' };
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: '50-move rule' };
  return null;
}

// ---------- Clocks ----------
// Time controls like chess.com: "minutes+increment seconds". 'none' = no clock.
export const TIME_CONTROLS = [
  { id: '1+0', cat: 'Bullet' }, { id: '1+1', cat: 'Bullet' }, { id: '2+1', cat: 'Bullet' },
  { id: '3+0', cat: 'Blitz' }, { id: '3+2', cat: 'Blitz' }, { id: '5+0', cat: 'Blitz' },
  { id: '10+0', cat: 'Rapid' }, { id: '15+10', cat: 'Rapid' }, { id: '30+0', cat: 'Rapid' },
  { id: 'none', cat: 'No timer' },
];
export const DEFAULT_TC = '10+0';

export function tcLabel(id) {
  if (!id || id === 'none') return 'No timer';
  const [m, s] = id.split('+');
  return s === '0' ? `${m} min` : `${m} | ${s}`;
}

// A fresh clock for a time control id, or null for "no timer".
export function newClock(id) {
  const tc = TIME_CONTROLS.find((t) => t.id === id);
  if (!tc || id === 'none') return null;
  const [m, s] = id.split('+').map(Number);
  const base = m * 60000;
  return { id, base, inc: s * 1000, w: base, b: base, running: null, since: 0 };
}

// Time left for a colour at time `now`.
export function timeLeft(clock, color, now) {
  if (!clock) return Infinity;
  return clock.running === color ? clock[color] - (now - clock.since) : clock[color];
}

// Call after `color` has made a move; `plies` = number of moves played now.
// Clocks start once both sides have made their first move (like chess.com).
// Returns false if `color` had already run out of time.
export function clockAfterMove(clock, color, plies, now) {
  if (!clock) return true;
  if (clock.running === color) {
    clock[color] -= now - clock.since;
    if (clock[color] <= 0) { clock[color] = 0; clock.running = null; return false; }
    clock[color] += clock.inc;
  }
  clock.running = plies >= 2 ? (color === 'w' ? 'b' : 'w') : null;
  clock.since = now;
  return true;
}

// Freeze the clock (game over).
export function stopClock(clock, now) {
  if (!clock || !clock.running) return;
  const c = clock.running;
  clock[c] = Math.max(0, clock[c] - (now - clock.since));
  clock.running = null;
}

// Result when `color` runs out of time. It's a draw if the other side can't possibly checkmate.
export function timeoutResult(chess, color) {
  const other = color === 'w' ? 'b' : 'w';
  const left = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === other && p.type !== 'k') left.push(p.type);
  const cantMate = left.length === 0 || (left.length === 1 && (left[0] === 'b' || left[0] === 'n'));
  return cantMate ? { winner: null, reason: 'timeout vs insufficient material' } : { winner: other, reason: 'timeout' };
}
