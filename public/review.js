// Game Review: runs Stockfish in the browser and grades every move.
import { Chess } from '/lib/chess.js';

export const DEPTH = 14;
const MOVETIME = 900; // ms cap per position so long games don't take forever

// ---------- Move grades ----------
export const GRADES = {
  brilliant:  { label: 'Brilliant',  sym: '!!', color: '#1baca6' },
  great:      { label: 'Great',      sym: '!',  color: '#5c8bb0' },
  best:       { label: 'Best',       sym: '★',  color: '#81b64c' },
  excellent:  { label: 'Excellent',  sym: '👍', color: '#96bc4b' },
  good:       { label: 'Good',       sym: '✓',  color: '#96af8b' },
  forced:     { label: 'Forced',     sym: '→',  color: '#97a3a6' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!', color: '#f7c045' },
  mistake:    { label: 'Mistake',    sym: '?',  color: '#ffa459' },
  miss:       { label: 'Miss',       sym: '✕',  color: '#ff7769' },
  blunder:    { label: 'Blunder',    sym: '??', color: '#fa412d' },
};
export const GRADE_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// ---------- Engine (one shared Web Worker) ----------
class Engine {
  constructor() {
    this.worker = new Worker('/engine/stockfish-19-lite-single.js');
    this.waiters = [];
    this.onInfo = null;
    this.worker.onmessage = (e) => this.line(String(e.data));
    this.send('uci');
    this.ready = this.until((l) => l === 'uciok').then(() => {
      this.send('setoption name MultiPV value 2');
      this.send('isready');
      return this.until((l) => l === 'readyok');
    });
    this.queue = Promise.resolve();
  }
  send(cmd) { this.worker.postMessage(cmd); }
  until(test) { return new Promise((res) => this.waiters.push({ test, res })); }
  line(l) {
    if (this.onInfo) this.onInfo(l);
    this.waiters = this.waiters.filter((w) => (w.test(l) ? (w.res(l), false) : true));
  }
  // Returns { lines: {1:{score,pv}, 2:{...}} } where score is from the side to move.
  analyse(fen) {
    const job = this.queue.then(async () => {
      await this.ready;
      const lines = {};
      this.onInfo = (l) => {
        if (!l.startsWith('info') || !l.includes(' pv ')) return;
        const k = +(l.match(/ multipv (\d+)/) || [0, 1])[1];
        const s = l.match(/ score (cp|mate) (-?\d+)/);
        const pv = l.split(' pv ')[1].trim().split(/\s+/);
        if (s) lines[k] = { score: s[1] === 'cp' ? { cp: +s[2] } : { mate: +s[2] }, pv };
      };
      this.send('position fen ' + fen);
      this.send(`go depth ${DEPTH} movetime ${MOVETIME}`);
      await this.until((l) => l.startsWith('bestmove'));
      this.onInfo = null;
      return lines;
    });
    this.queue = job.catch(() => {});
    return job;
  }
  newGame() { this.queue = this.queue.then(() => { this.send('ucinewgame'); }); }
}
let engine = null;
const getEngine = () => (engine ||= new Engine());

// ---------- Evaluation helpers (all from White's point of view) ----------
// eval = { cp } or { mate } ; mate > 0 means White mates.
function toWhite(score, turn) {
  const s = turn === 'w' ? 1 : -1;
  return score.mate !== undefined ? { mate: score.mate * s } : { cp: score.cp * s };
}
// Win chance for White, 0..100 (same curve lichess uses).
export function winPct(ev) {
  if (ev.mate !== undefined) return ev.mate > 0 ? 100 : ev.mate < 0 ? 0 : 50;
  const cp = Math.max(-1500, Math.min(1500, ev.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
const winFor = (ev, color) => (color === 'w' ? winPct(ev) : 100 - winPct(ev));

export function evalText(ev) {
  if (ev.over) return ev.mate > 0 ? '1-0' : '0-1';
  if (ev.mate !== undefined) return ev.mate === 0 ? '#' : (ev.mate > 0 ? 'M' : '-M') + Math.abs(ev.mate);
  const v = ev.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
}

function uciToMove(chess, uci) {
  try { return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return null; }
}
function sanOf(fen, uci) {
  const c = new Chess(fen); const m = uciToMove(c, uci); return m ? m.san : uci;
}

// Did this move leave the moved piece where it can be taken for less than it's worth?
function isSacrifice(fenAfter, move) {
  const val = VALUE[move.promotion || move.piece];
  if (val < 3) return false;
  if (move.captured && VALUE[move.captured] >= val) return false; // fair trade, not a sac
  const after = new Chess(fenAfter);
  const opp = move.color === 'w' ? 'b' : 'w';
  const attackers = after.attackers(move.to, opp);
  if (!attackers.length) return false;
  const cheapest = Math.min(...attackers.map((sq) => VALUE[after.get(sq).type] || 99));
  const defended = after.attackers(move.to, move.color).length > 0;
  return !defended || cheapest < val;
}

// Material the mover loses along the engine's best line after their move.
function materialLost(fenAfter, pv, mover) {
  const c = new Chess(fenAfter);
  let net = 0, biggest = null;
  for (const uci of pv.slice(0, 6)) {
    const m = uciToMove(c, uci);
    if (!m) break;
    if (m.captured) {
      if (m.color === mover) net += VALUE[m.captured];
      else { net -= VALUE[m.captured]; if (!biggest || VALUE[m.captured] > VALUE[biggest]) biggest = m.captured; }
    }
    if (m.promotion) net += (m.color === mover ? 1 : -1) * (VALUE[m.promotion] - 1);
  }
  return { net, biggest };
}

// ---------- Analyse a whole game ----------
// moves: chess.js verbose history. Returns a review object; calls onProgress(done, total) as it goes.
export async function analyseGame(moves, onProgress, isCancelled) {
  const c = new Chess();
  const fens = [c.fen()];
  for (const m of moves) { c.move({ from: m.from, to: m.to, promotion: m.promotion }); fens.push(c.fen()); }

  const eng = getEngine();
  eng.newGame();
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled()) return null;
    const pos = new Chess(fens[i]);
    const turn = pos.turn();
    // Checkmated: the side to move has lost. mate ±1 gives the right win chance; `over` shows "1-0"/"0-1".
    if (pos.isCheckmate()) evals.push({ ev: { mate: turn === 'w' ? -1 : 1, over: true }, terminal: true, mated: turn });
    else if (pos.isDraw() || pos.isStalemate()) evals.push({ ev: { cp: 0 }, terminal: true });
    else {
      const lines = await eng.analyse(fens[i]);
      const l1 = lines[1] || { score: { cp: 0 }, pv: [] };
      const l2 = lines[2];
      evals.push({ ev: toWhite(l1.score, turn), best: l1.pv[0], pv: l1.pv, second: l2 ? toWhite(l2.score, turn) : null });
    }
    onProgress(i + 1, fens.length);
  }

  // Grade each move.
  const grades = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i], mover = m.color;
    const before = evals[i], after = evals[i + 1];
    const wb = winFor(before.ev, mover), wa = winFor(after.ev, mover);
    const loss = Math.max(0, wb - wa) / 100;
    const played = m.from + m.to + (m.promotion || '');
    const legal = new Chess(fens[i]).moves().length;
    const isBest = played === before.best;
    let g;
    if (legal === 1) g = 'forced';
    else if (isBest || loss < 0.003) g = 'best';
    else if (loss <= 0.02) g = 'excellent';
    else if (loss <= 0.05) g = 'good';
    else if (loss <= 0.10) g = 'inaccuracy';
    else if (loss <= 0.20) g = 'mistake';
    else g = 'blunder';

    if ((g === 'best' || g === 'excellent') && legal > 1) {
      const sac = isSacrifice(fens[i + 1], m);
      if (sac && wa >= 50 && wb < 97 && loss <= 0.02) g = 'brilliant';
      else if (isBest && before.second && wb < 95 && wb > 5 && winFor(before.ev, mover) - winFor(before.second, mover) >= 18) g = 'great';
    }
    const prev = grades[i - 1];
    if ((g === 'mistake' || g === 'blunder') && prev && ['mistake', 'blunder', 'miss'].includes(prev.grade) && wa >= 35) g = 'miss';

    const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, wb - wa)) - 3.1669));
    grades.push({ grade: g, acc, loss, wb, wa, bestUci: before.best, bestSan: before.best ? sanOf(fens[i], before.best) : null, bestEval: before.ev });
  }

  // Plain-English notes for each move.
  grades.forEach((gr, i) => { gr.note = explain(moves[i], gr, evals[i], evals[i + 1], fens[i + 1]); });

  return { fens, evals, grades, accuracy: { w: gameAccuracy(evals, grades, moves, 'w'), b: gameAccuracy(evals, grades, moves, 'b') } };
}

function explain(m, gr, before, after, fenAfter) {
  const mover = m.color;
  const notes = [];
  const moverMate = (ev) => (ev.mate !== undefined ? (mover === 'w' ? ev.mate : -ev.mate) : null);
  const mb = moverMate(before.ev), ma = moverMate(after.ev);
  const bad = ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(gr.grade);
  if (after.terminal && after.mated) return 'Checkmate!';
  if (gr.grade === 'brilliant') notes.push('A great sacrifice — it gives up material but the position holds up.');
  if (gr.grade === 'great') notes.push('The only move that keeps your advantage here.');
  if (gr.grade === 'forced') notes.push('It was the only legal move.');
  if (bad && mb !== null && mb > 0 && !(ma !== null && ma > 0)) notes.push(`You had a forced checkmate in ${mb}.`);
  if (ma !== null && ma < 0 && Math.abs(ma) < 30) notes.push(`Now your opponent can force checkmate in ${Math.abs(ma)}.`);
  else if (bad && after.pv) {
    const { net, biggest } = materialLost(fenAfter, after.pv, mover);
    if (net <= -2 && biggest) notes.push(`This loses your ${PIECE_NAME[biggest]}.`);
  }
  if (gr.grade === 'miss') notes.push('Your opponent just made a mistake and you missed the chance to punish it.');
  return notes.join(' ');
}

// Game accuracy like lichess: mix of a volatility-weighted mean and a harmonic mean.
function gameAccuracy(evals, grades, moves, color) {
  const wins = evals.map((e) => winPct(e.ev));
  const win = Math.max(2, Math.min(8, Math.floor(moves.length / 10)));
  const accs = [], weights = [];
  grades.forEach((g, i) => {
    if (moves[i].color !== color) return;
    const slice = wins.slice(Math.max(0, i - win + 1), i + 2);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
    accs.push(g.acc); weights.push(Math.max(0.5, Math.min(12, sd)));
  });
  if (!accs.length) return null;
  const weighted = accs.reduce((a, x, i) => a + x * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
  const harmonic = accs.length / accs.reduce((a, x) => a + 1 / Math.max(x, 1), 0);
  return (weighted + harmonic) / 2;
}
