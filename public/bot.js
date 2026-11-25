// Computer opponents. Each bot runs Stockfish (its own Web Worker) and then
// picks a move the way a player of its strength would: weaker bots look less
// deep, choose among more "okay" moves and sometimes just play something random.
import { Chess } from '/lib/chess.js';

export const BOTS = [
  { id: 'pip',   name: 'Omar',  rating: 250,  emoji: '🐣', color: '#f5c542', blurb: 'Just learned how the horse moves.',
    depth: 1,  mpv: 5, window: 400, random: 0.45,
    say: { hi: 'Hiii! Is the horsey the one that jumps? 🐣', win: 'I WON?! Wait till I tell my mum!', lose: 'Good game! You are really good 🥺', draw: 'A draw! That means we are both winners!' } },
  { id: 'momo',  name: 'Momo',  rating: 500,  emoji: '🐼', color: '#d9d9d9', blurb: 'Plays for fun, snacks in between.',
    depth: 2,  mpv: 5, window: 300, random: 0.25,
    say: { hi: 'Hello! I brought bamboo. Let’s play 🐼', win: 'Yay! Bamboo party time!', lose: 'Oof, you got me. Good game!', draw: 'Draw! Want to share my bamboo?' } },
  { id: 'luna',  name: 'Luna',  rating: 800,  emoji: '🌙', color: '#9b8cff', blurb: 'Knows the basics, still drops pieces.',
    depth: 4,  mpv: 4, window: 200, random: 0.12,
    say: { hi: 'Ready when you are ✨', win: 'The stars were on my side tonight 🌙', lose: 'Nicely played! I’ll study more.', draw: 'Balanced, like day and night.' } },
  { id: 'rex',   name: 'Rex',   rating: 1100, emoji: '🦖', color: '#6fbf4a', blurb: 'Loves attacking. Sometimes too much.',
    depth: 6,  mpv: 4, window: 120, random: 0.06,
    say: { hi: 'RAWR! I’m coming for your king 🦖', win: 'ROAR! Extinct!', lose: 'Ugh… my arms were too short for that one.', draw: 'Hmph. A draw. Rematch?' } },
  { id: 'nova',  name: 'Nova',  rating: 1400, emoji: '🚀', color: '#ff8a4c', blurb: 'Club player. Solid and quick.',
    depth: 8,  mpv: 3, window: 70,  random: 0.025,
    say: { hi: 'Systems ready. Launching in 3, 2, 1 🚀', win: 'Mission complete. GG!', lose: 'Houston, we have a problem. Well played!', draw: 'Stable orbit. A fair draw.' } },
  { id: 'sage',  name: 'Sage',  rating: 1700, emoji: '🦉', color: '#c79a5b', blurb: 'Patient. Waits for your mistakes.',
    depth: 11, mpv: 3, window: 40,  random: 0.01,
    say: { hi: 'Take your time. Chess rewards patience 🦉', win: 'Every mistake is a lesson. Good game.', lose: 'Impressive. The student has become the master.', draw: 'A wise result. Well played.' } },
  { id: 'titan', name: 'Titan', rating: 2000, emoji: '🗿', color: '#8fa3b0', blurb: 'Strong and calm. Very hard to beat.',
    depth: 14, mpv: 2, window: 18,  random: 0,
    say: { hi: '…', win: 'As expected.', lose: '…impressive. Respect. 🗿', draw: 'Hm. A draw. Acceptable.' } },
  { id: 'apex',  name: 'Liam',  rating: 2600, emoji: '🤖', color: '#4cc3d9', blurb: 'Full-power engine. Good luck.',
    depth: 18, mpv: 1, window: 0,   random: 0, movetime: 2500,
    say: { hi: 'ANALYSIS STARTED. PROBABILITY OF YOUR WIN: 0.01% 🤖', win: 'CHECKMATE CONFIRMED. GG, HUMAN.', lose: 'ERROR… ERROR… THIS WAS NOT CALCULATED.', draw: 'DRAW DETECTED. INTERESTING.' } },
];
export const botById = (id) => BOTS.find((b) => b.id === id) || BOTS[2];

// What each bot says after your move. roast = you blundered, scared = you found something strong.
const REACT = {
  pip: {
    roast: ['Even I saw that one! 🐣', 'Was that on purpose? I’m confused 😅', 'My baby brother wouldn’t play that lol', 'Oopsie! Can I have that? 🐣'],
    scared: ['Wait what? How did you do that?! 😨', 'Nooo, my pieces! 🥺', 'That’s not fair, you’re too good!', 'I’m telling my mum 😭'],
  },
  momo: {
    roast: ['I dropped my bamboo watching that move 🐼', 'Bro, even pandas know that’s bad', 'I’ll take that, thanks 😋', 'Did you play that with your eyes closed?'],
    scared: ['Uh oh. This panda is panicking 🐼💦', 'Okay okay, slow down!', 'That was rude. Good, but rude.', 'Can we pretend you didn’t see that?'],
  },
  luna: {
    roast: ['Even the moon saw that coming 🌙', 'Hmm, the stars did NOT approve that move.', 'Thank you for the gift ✨', 'Was that a typo?'],
    scared: ['Oh no… that was beautiful 😳', 'The stars are turning against me 🌠', 'Okay, I didn’t see that one.', 'You’ve been practising, haven’t you?'],
  },
  rex: {
    roast: ['HAHA! Dino snack! 🦖🍖', 'Was that move from the Stone Age?', 'RAWR, thanks for the free piece!', 'You blundered harder than the asteroid hit us.'],
    scared: ['RAWR?! …I mean, uh, rawr 😰', 'My tiny arms can’t defend this!', 'Okay that one actually hurt 🦖💥', 'Who taught you that?!'],
  },
  nova: {
    roast: ['Houston, YOU have a problem 🚀', 'That move just crash-landed.', 'Abort mission! …oh wait, that’s your piece.', 'Engines detected: a blunder. Big one.'],
    scared: ['Alert! Alert! Hull breach! 🚨', 'That was a rocket of a move 😬', 'Recalculating… recalculating…', 'Okay, you’ve got real thrusters.'],
  },
  sage: {
    roast: ['Patience, young one. That was not it. 🦉', 'A wise player would take that back. You can’t.', 'Hoo… hoo… what was that?', 'Every blunder is a lesson. That was a big lesson.'],
    scared: ['Hoo! A strong move indeed. 🦉', 'The student surprises the teacher.', 'I must think carefully now…', 'Impressive. I did not foresee this.'],
  },
  titan: {
    roast: ['…really? 🗿', 'Mistake noted.', 'Thank you.', 'Hm. Disappointing.'],
    scared: ['…hm. 😐', 'Interesting.', 'You are stronger than you look.', 'That was… correct.'],
  },
  apex: {
    roast: ['BLUNDER DETECTED. WIN PROBABILITY UPDATED: 99.9% 🤖', 'ERROR: HUMAN MOVE NOT FOUND IN OPENING BOOK OF GOOD MOVES.', 'THANK YOU FOR YOUR DONATION.', 'LOL. (THAT IS ROBOT FOR LAUGHING.)'],
    scared: ['WARNING: UNEXPECTED STRONG MOVE. 😳', 'CPU TEMPERATURE RISING…', 'THAT WAS… OPTIMAL? RECALIBRATING.', 'SYSTEM NERVOUS. THIS IS NEW.'],
  },
};
export function reactLine(id, kind, last) {
  const list = (REACT[id] || REACT.luna)[kind];
  const pool = list.filter((l) => l !== last);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- Engine (one Worker just for bots, separate from Game Review) ----------
let worker = null, waiters = [], onLine = null, queue = Promise.resolve(), readyP = null;
function eng() {
  if (worker) return readyP;
  worker = new Worker('/engine/stockfish-19-lite-single.js');
  worker.onmessage = (e) => {
    const l = String(e.data);
    if (onLine) onLine(l);
    waiters = waiters.filter((w) => (w.test(l) ? (w.res(l), false) : true));
  };
  const send = (c) => worker.postMessage(c);
  send('uci');
  readyP = until((l) => l === 'uciok').then(() => { send('isready'); return until((l) => l === 'readyok'); });
  return readyP;
}
function until(test) { return new Promise((res) => waiters.push({ test, res })); }
export function warmUp() { try { eng(); } catch {} }

// Score of a line in centipawns from the mover's point of view (mates count as huge).
const cpOf = (s) => (s.mate !== undefined ? (s.mate > 0 ? 100000 - s.mate * 100 : -100000 - s.mate * 100) : s.cp);

function search(fen, bot) {
  const job = queue.then(async () => {
    await eng();
    const lines = {};
    onLine = (l) => {
      if (!l.startsWith('info') || !l.includes(' pv ')) return;
      const k = +(l.match(/ multipv (\d+)/) || [0, 1])[1];
      const s = l.match(/ score (cp|mate) (-?\d+)/);
      const mv = l.split(' pv ')[1].trim().split(/\s+/)[0];
      if (s && mv) lines[k] = { score: s[1] === 'cp' ? { cp: +s[2] } : { mate: +s[2] }, move: mv };
    };
    worker.postMessage(`setoption name MultiPV value ${bot.mpv}`);
    worker.postMessage('position fen ' + fen);
    worker.postMessage(`go depth ${bot.depth}` + (bot.movetime ? ` movetime ${bot.movetime}` : ' movetime 1500'));
    const best = await until((l) => l.startsWith('bestmove'));
    onLine = null;
    return { lines: Object.values(lines), best: best.split(' ')[1] };
  });
  queue = job.catch(() => {});
  return job;
}

// Quick, honest evaluation of a position (used to react to your moves, not to pick the bot's).
// Returns the win chance (0-100) for the side to move.
export function judge(fen) {
  const job = queue.then(async () => {
    await eng();
    let score = null;
    onLine = (l) => {
      if (!l.startsWith('info') || !l.includes(' pv ')) return;
      const s = l.match(/ score (cp|mate) (-?\d+)/);
      if (s) score = s[1] === 'cp' ? { cp: +s[2] } : { mate: +s[2] };
    };
    worker.postMessage('setoption name MultiPV value 1');
    worker.postMessage('position fen ' + fen);
    worker.postMessage('go depth 10 movetime 400');
    await until((l) => l.startsWith('bestmove'));
    onLine = null;
    if (!score) return 50;
    if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
    const cp = Math.max(-1500, Math.min(1500, score.cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  });
  queue = job.catch(() => {});
  return job;
}

// Pick the bot's move for this position. Returns {from, to, promotion}.
export async function botMove(fen, bot) {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;
  const asMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

  // Weak bots sometimes just play whatever catches their eye (often a capture).
  if (Math.random() < bot.random) {
    const caps = legal.filter((m) => m.captured);
    const pool = caps.length && Math.random() < 0.5 ? caps : legal;
    const m = pool[Math.floor(Math.random() * pool.length)];
    return { from: m.from, to: m.to, promotion: m.promotion ? 'q' : undefined };
  }
  let res;
  try { res = await search(fen, bot); } catch { res = null; }
  if (!res || !res.lines.length) {
    const m = legal[Math.floor(Math.random() * legal.length)];
    return { from: m.from, to: m.to, promotion: m.promotion ? 'q' : undefined };
  }
  if (bot.mpv === 1 || !bot.window) return asMove(res.best || res.lines[0].move);
  // Choose among the engine's top moves; closer to the best = more likely.
  const scored = res.lines.map((l) => ({ move: l.move, cp: cpOf(l.score) }));
  const top = Math.max(...scored.map((s) => s.cp));
  const ok = scored.filter((s) => top - s.cp <= bot.window);
  const weights = ok.map((s) => Math.exp(-(top - s.cp) / Math.max(1, bot.window / 2.5)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ok.length; i++) { r -= weights[i]; if (r <= 0) return asMove(ok[i].move); }
  return asMove(ok[0].move);
}

// How long the bot "thinks" (ms), so it feels like a person, not a machine.
export function thinkTime(chess, lastMove) {
  const legal = chess.moves().length;
  const plies = chess.history().length;
  const rnd = (a, b) => a + Math.random() * (b - a);
  if (legal === 1) return rnd(700, 1300);                       // only one move: play it
  if (plies < 6) return rnd(1300, 2400);                         // opening moves come quicker
  const recapture = lastMove && lastMove.captured &&
    chess.moves({ verbose: true }).some((m) => m.to === lastMove.to && m.captured);
  if (recapture && Math.random() < 0.6) return rnd(1500, 2600);  // obvious take-back
  return rnd(2800, 4300);                                        // normal move: 3–4 seconds
}
