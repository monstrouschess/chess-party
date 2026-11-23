import { Chess } from '/lib/chess.js';
import { resultOf, CODE_CHARS, CODE_LEN } from '/shared.js';

const $ = (s) => document.querySelector(s);
const FILES = 'abcdefgh';
const NAMES = { w: 'White', b: 'Black' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// ---------- State ----------
const S = {
  mode: null,            // 'local' | 'party'
  chess: new Chess(),
  orientation: 'w',      // colour shown at the bottom
  myColor: null,         // party only
  result: null,
  lastMove: null,
  selected: null, dests: [],
  premoves: [], premoveColor: null,
  arrows: [], marks: new Set(),
  promo: null, drag: null, right: null,
  party: { code: null, gameNo: 0, oppSeated: false, oppHere: false, rematchMe: false, rematchThem: false, connected: false },
};

const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};
let TOKEN = ss.get('cp_token');
if (!TOKEN) { TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36); ss.set('cp_token', TOKEN); }

// ---------- Square helpers ----------
const fr = (sq) => [FILES.indexOf(sq[0]), +sq[1]];
const sqName = (f, r) => FILES[f] + r;
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 1 && r <= 8;
function rc(sq) { const [f, r] = fr(sq); return S.orientation === 'w' ? [8 - r, f] : [r - 1, 7 - f]; }
function sqOf(row, col) { return S.orientation === 'w' ? sqName(col, 8 - row) : sqName(7 - col, row + 1); }

const boardEl = $('#board');
function sqAt(e) {
  const b = boardEl.getBoundingClientRect();
  const col = Math.floor(((e.clientX - b.left) / b.width) * 8);
  const row = Math.floor(((e.clientY - b.top) / b.height) * 8);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return sqOf(row, col);
}

// ---------- Who may move ----------
const turn = () => S.chess.turn();
function canMove(color) {
  if (S.result || S.promo) return false;
  if (S.mode === 'local') return color === turn();
  if (S.mode === 'party') return S.party.oppSeated && color === S.myColor && turn() === S.myColor;
  return false;
}
function canPre(color) {
  if (S.result) return false;
  // Premoves are only for party games; on one shared screen they'd just get in the way.
  if (S.mode === 'party') return S.party.oppSeated && color === S.myColor && turn() !== S.myColor;
  return false;
}

// ---------- Premoves ----------
// The position as it will look after all queued premoves (what we draw).
function virtualPieces() {
  const m = new Map();
  for (const row of S.chess.board()) for (const c of row) if (c) m.set(c.square, { type: c.type, color: c.color });
  for (const pm of S.premoves) {
    const p = m.get(pm.from);
    if (!p) continue;
    m.delete(pm.from);
    const [ff, r1] = fr(pm.from); const [tf, tr] = fr(pm.to);
    if (p.type === 'k' && Math.abs(tf - ff) === 2) {
      const rf = tf > ff ? 7 : 0, nf = tf > ff ? 5 : 3;
      const rook = m.get(sqName(rf, r1));
      if (rook) { m.delete(sqName(rf, r1)); m.set(sqName(nf, r1), rook); }
    }
    m.set(pm.to, p.type === 'p' && (tr === 8 || tr === 1) ? { type: 'q', color: p.color } : p);
  }
  return m;
}

// Every square a piece could possibly reach, ignoring blockers (like chess.com premoves).
function premoveDests(m, sq) {
  const p = m.get(sq); const [f, r] = fr(sq); const out = [];
  const add = (F, R) => { if (onBoard(F, R)) out.push(sqName(F, R)); };
  if (p.type === 'p') {
    const d = p.color === 'w' ? 1 : -1;
    add(f, r + d); if (r === (p.color === 'w' ? 2 : 7)) add(f, r + 2 * d);
    add(f - 1, r + d); add(f + 1, r + d);
  } else if (p.type === 'n') {
    for (const [a, b] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(f + a, r + b);
  } else if (p.type === 'k') {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) add(f + a, r + b);
    const home = p.color === 'w' ? 1 : 8;
    if (f === 4 && r === home) {
      const hr = m.get(sqName(7, home)), ar = m.get(sqName(0, home));
      if (hr && hr.type === 'r' && hr.color === p.color) add(6, home);
      if (ar && ar.type === 'r' && ar.color === p.color) add(2, home);
    }
  } else {
    const dirs = [];
    if (p.type !== 'b') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    if (p.type !== 'r') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    for (const [a, b] of dirs) for (let F = f + a, R = r + b; onBoard(F, R); F += a, R += b) out.push(sqName(F, R));
  }
  return out;
}

function clearPremoves() { S.premoves = []; S.premoveColor = null; }

function tryPremove() {
  if (!S.premoves.length || S.drag || !canMove(S.premoveColor)) return;
  const pm = S.premoves.shift();
  const p = S.chess.get(pm.from);
  const legal = p && p.color === S.premoveColor && S.chess.moves({ square: pm.from, verbose: true }).some((x) => x.to === pm.to);
  if (!legal) { clearPremoves(); refreshSelection(); render(); return; }
  const promotion = p.type === 'p' && (pm.to[1] === '8' || pm.to[1] === '1') ? 'q' : undefined;
  if (!S.premoves.length) S.premoveColor = null;
  commit(pm.from, pm.to, promotion, false);
}

// ---------- Selecting & moving ----------
function select(sq) {
  const m = virtualPieces(); const p = m.get(sq);
  S.selected = sq;
  if (p && canMove(p.color)) S.dests = S.chess.moves({ square: sq, verbose: true }).map((x) => x.to);
  else if (p && canPre(p.color)) S.dests = premoveDests(m, sq);
  else { S.selected = null; S.dests = []; }
}
function clearSel() { S.selected = null; S.dests = []; }
function refreshSelection() {
  const sq = S.drag ? S.drag.from : S.selected;
  if (sq) select(sq);
  if (S.drag && !S.selected) cancelDrag();
}

function userMove(from, to, dragged) {
  const p = virtualPieces().get(from);
  if (!p) return render();
  if (canMove(p.color)) {
    if (p.type === 'p' && (to[1] === '8' || to[1] === '1') &&
      S.chess.moves({ square: from, verbose: true }).some((x) => x.to === to)) {
      S.promo = { from, to, color: p.color };
      return render();
    }
    commit(from, to, undefined, dragged);
  } else if (canPre(p.color)) {
    S.premoves.push({ from, to });
    S.premoveColor = p.color;
    sound('premove');
    render();
  } else render();
}

function commit(from, to, promotion, dragged) {
  let mv;
  try { mv = S.chess.move({ from, to, promotion }); } catch { mv = null; }
  if (!mv) { render(); return; }
  S.lastMove = { from: mv.from, to: mv.to };
  clearSel();
  if (S.mode === 'party') send({ type: 'move', from, to, promotion });
  if (S.mode === 'local') {
    S.result = resultOf(S.chess);
    saveLocal();
  }
  sound(soundFor(mv));
  render(dragged ? null : mv);
  if (S.result) gameOver();
  else setTimeout(tryPremove, 80);
}

// ---------- Pointer input ----------
boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

boardEl.addEventListener('pointerdown', (e) => {
  if (S.promo) return;
  const sq = sqAt(e);
  if (!sq) return;
  if (e.button === 2) { S.right = { from: sq, to: sq }; e.preventDefault(); return; }
  if (e.button !== 0) return;
  e.preventDefault();
  let dirty = false;
  if (S.arrows.length || S.marks.size) { S.arrows = []; S.marks.clear(); dirty = true; }

  const m = virtualPieces(); const p = m.get(sq);
  if (S.selected && sq !== S.selected && S.dests.includes(sq)) {
    const from = S.selected; clearSel();
    userMove(from, sq, false);
    return;
  }
  if (p && (canMove(p.color) || canPre(p.color))) {
    const wasSelected = S.selected === sq;
    select(sq);
    startDrag(e, sq, p, wasSelected);
    render();
    return;
  }
  // Plain click on the board: drop selection and cancel premoves.
  if (S.selected || S.premoves.length) { clearSel(); clearPremoves(); dirty = true; }
  if (dirty) render();
});

function startDrag(e, sq, p, wasSelected) {
  const ghost = document.createElement('div');
  ghost.id = 'ghost';
  ghost.className = `pc ${p.color}${p.type}`;
  boardEl.appendChild(ghost);
  S.drag = { from: sq, ghost, wasSelected, over: sq };
  moveGhost(e);
}
function moveGhost(e) {
  const b = boardEl.getBoundingClientRect();
  S.drag.ghost.style.left = `${e.clientX - b.left}px`;
  S.drag.ghost.style.top = `${e.clientY - b.top}px`;
}
function cancelDrag() {
  if (!S.drag) return;
  S.drag.ghost.remove(); S.drag = null;
}

window.addEventListener('pointermove', (e) => {
  if (S.drag) {
    moveGhost(e);
    const over = sqAt(e);
    if (over !== S.drag.over) {
      boardEl.querySelector('.sq.hover')?.classList.remove('hover');
      S.drag.over = over;
      if (over) sqEl(over)?.classList.add('hover');
    }
  } else if (S.right) {
    const to = sqAt(e) || S.right.to;
    if (to !== S.right.to) { S.right.to = to; drawArrows(); }
  }
});

window.addEventListener('pointerup', (e) => {
  if (S.right && e.button === 2) {
    const { from } = S.right; const to = sqAt(e) || S.right.to;
    S.right = null;
    if (from === to) { S.marks.has(from) ? S.marks.delete(from) : S.marks.add(from); }
    else {
      const i = S.arrows.findIndex((a) => a.from === from && a.to === to);
      i >= 0 ? S.arrows.splice(i, 1) : S.arrows.push({ from, to });
    }
    render();
    return;
  }
  if (S.drag && e.button === 0) {
    const d = S.drag; const to = sqAt(e);
    cancelDrag();
    if (to && to !== d.from && S.dests.includes(to)) { clearSel(); userMove(d.from, to, true); return; }
    if (to !== d.from || d.wasSelected) clearSel();
    render();
  }
});

window.addEventListener('blur', () => { if (S.drag) { cancelDrag(); clearSel(); render(); } S.right = null; });

// ---------- Rendering ----------
const squaresEl = $('#squares');
const sqEl = (sq) => squaresEl.querySelector(`[data-sq="${sq}"]`);

function kingSquare(color) {
  for (const row of S.chess.board()) for (const c of row) if (c && c.type === 'k' && c.color === color) return c.square;
  return null;
}

function render(anim) {
  const m = virtualPieces();
  const pre = new Set(S.premoves.flatMap((p) => [p.from, p.to]));
  const hl = new Set();
  if (S.lastMove) { hl.add(S.lastMove.from); hl.add(S.lastMove.to); }
  if (S.selected) hl.add(S.selected);
  const check = S.chess.inCheck() ? kingSquare(turn()) : null;
  const dests = new Set(S.dests);

  let html = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = sqOf(row, col);
      const [f, r] = fr(sq);
      const cls = ['sq', (f + r) % 2 === 1 ? 'd' : 'l'];
      if (S.marks.has(sq)) cls.push('mark');
      else if (pre.has(sq)) cls.push('pre');
      else if (hl.has(sq)) cls.push('hl');
      if (sq === check) cls.push('check');
      const p = m.get(sq);
      if (dests.has(sq)) cls.push('dest', p ? 'cap' : 'empty');
      if (S.drag && S.drag.over === sq) cls.push('hover');
      let inner = '';
      if (col === 0) inner += `<span class="coord rank">${r}</span>`;
      if (row === 7) inner += `<span class="coord file">${sq[0]}</span>`;
      if (p) inner += `<div class="pc ${p.color}${p.type}${S.drag && S.drag.from === sq ? ' ghosted' : ''}"></div>`;
      html += `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
    }
  }
  squaresEl.innerHTML = html;
  if (anim) animate(anim);
  drawArrows();
  renderPromo();
  renderOverlay();
  renderSide();
}

function animate(mv) {
  const el = sqEl(mv.to)?.querySelector('.pc');
  if (!el) return;
  const [r0, c0] = rc(mv.from); const [r1, c1] = rc(mv.to);
  el.style.transition = 'none';
  el.style.transform = `translate(${(c0 - c1) * 100}%, ${(r0 - r1) * 100}%)`;
  el.style.zIndex = 5;
  el.getBoundingClientRect();
  el.style.transition = 'transform 120ms ease-out';
  el.style.transform = '';
}

// Arrows: straight, or an L-shape for knight jumps (like chess.com).
function drawArrows() {
  const svg = $('#arrows');
  const list = [...S.arrows];
  if (S.right && S.right.to !== S.right.from) list.push({ ...S.right, preview: true });
  const center = (sq) => { const [r, c] = rc(sq); return [c * 100 + 50, r * 100 + 50]; };
  let out = '';
  for (const a of list) {
    const [x0, y0] = center(a.from); let [x1, y1] = center(a.to);
    const dx = x1 - x0, dy = y1 - y0;
    const pts = [[x0, y0]];
    if ((Math.abs(dx) === 100 && Math.abs(dy) === 200) || (Math.abs(dx) === 200 && Math.abs(dy) === 100)) {
      pts.push(Math.abs(dx) > Math.abs(dy) ? [x1, y0] : [x0, y1]);
    }
    const [px, py] = pts[pts.length - 1];
    const len = Math.hypot(x1 - px, y1 - py), ux = (x1 - px) / len, uy = (y1 - py) / len;
    const head = 38, hw = 26;
    const bx = x1 - ux * head, by = y1 - uy * head;
    // Pull the start a little off the centre of the first square.
    const sl = Math.hypot(pts[1 % pts.length][0] - x0, pts[1 % pts.length][1] - y0) || 1;
    const sx = pts.length > 1 ? (pts[1][0] - x0) / sl : ux, sy = pts.length > 1 ? (pts[1][1] - y0) / sl : uy;
    pts[0] = [x0 + sx * 22, y0 + sy * 22];
    const d = 'M' + [...pts, [bx, by]].map((p) => p.join(' ')).join(' L');
    const poly = [[x1, y1], [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]].map((p) => p.join(',')).join(' ');
    out += `<g opacity="${a.preview ? 0.6 : 0.82}"><path d="${d}" stroke="rgb(255,170,0)" stroke-width="20" fill="none" stroke-linejoin="miter"/>` +
      `<polygon points="${poly}" fill="rgb(255,170,0)"/></g>`;
  }
  svg.innerHTML = out;
}

function renderPromo() {
  const el = $('#promo');
  if (!S.promo) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const [row, col] = rc(S.promo.to);
  const down = row === 0;
  const c = S.promo.color;
  el.innerHTML = `<div class="promo-col ${down ? '' : 'up'}" style="left:${col * 12.5}%;${down ? 'top:0' : 'bottom:0'}">` +
    ['q', 'n', 'r', 'b'].map((t) => `<div class="pc ${c}${t}" data-p="${t}"></div>`).join('') +
    `<div class="promo-x" data-p="x">✕</div></div>`;
  el.classList.remove('hidden');
}
$('#promo').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  const t = e.target.closest('[data-p]')?.dataset.p;
  const pr = S.promo; S.promo = null;
  if (t && t !== 'x') commit(pr.from, pr.to, t, true);
  else { clearSel(); render(); }
});

function renderOverlay() {
  const el = $('#board-overlay');
  if (S.mode === 'party' && !S.party.oppSeated) {
    const link = `${location.origin}/#${S.party.code}`;
    el.innerHTML = `<div class="wait-card"><h3>Waiting for your friend…</h3>
      <div class="muted">Send them this code. They click <b>Join party</b> and type it in.</div>
      <div class="big-code">${S.party.code || '·····'}</div>
      <div class="row"><button class="btn btn-green" data-copy="${S.party.code}">Copy code</button>
      <button class="btn" data-copy="${link}">Copy invite link</button></div>
      <div class="spinner"></div></div>`;
    el.classList.remove('hidden');
  } else { el.classList.add('hidden'); el.innerHTML = ''; }
}
$('#board-overlay').addEventListener('pointerdown', (e) => e.stopPropagation());
$('#board-overlay').addEventListener('click', (e) => {
  const v = e.target.closest('[data-copy]')?.dataset.copy;
  if (v) copy(v);
});

function material() {
  let w = 0, b = 0;
  for (const row of S.chess.board()) for (const c of row) if (c) (c.color === 'w' ? (w += VALUE[c.type]) : (b += VALUE[c.type]));
  return w - b;
}

function playerBar(color) {
  const captured = S.chess.history({ verbose: true }).filter((m) => m.color === color && m.captured).map((m) => m.captured);
  const order = 'pnbrq';
  captured.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const opp = color === 'w' ? 'b' : 'w';
  let caps = ''; let prev = null;
  for (const t of captured) { caps += `<div class="pc cp ${opp}${t}${prev && prev !== t ? ' gap' : ''}"></div>`; prev = t; }
  const diff = material() * (color === 'w' ? 1 : -1);
  if (diff > 0) caps += `<span class="adv">+${diff}</span>`;
  let name = NAMES[color], dot = '';
  if (S.mode === 'party') {
    const mine = color === S.myColor;
    name = mine ? `You (${NAMES[color]})` : `Friend (${NAMES[color]})`;
    const on = mine ? S.party.connected : S.party.oppHere;
    dot = `<span class="dot ${on ? 'on' : 'off'}" title="${on ? 'Online' : 'Offline'}"></span>`;
  }
  const active = !S.result && turn() === color && (S.mode === 'local' || S.party.oppSeated);
  return `<div class="avatar pc ${color}k"></div><div class="pinfo"><div class="pname">${name} ${dot}</div><div class="caps">${caps}</div></div>` +
    `<div class="turn-pill ${active ? 'active' : ''}">${active ? 'To move' : ''}</div>`;
}

function statusText() {
  if (S.mode === 'party') {
    if (!S.party.connected) return ['Reconnecting to the server…', true];
    if (!S.party.oppSeated) return ['Waiting for your friend to join…', false];
    if (!S.party.oppHere && !S.result) return ['Your friend disconnected. Waiting for them to come back…', true];
  }
  if (S.result) {
    const r = S.result;
    if (!r.winner) return [`Draw — ${r.reason}`, false];
    return [`${winnerText(r.winner)} — ${r.reason}`, false];
  }
  const t = turn();
  const who = S.mode === 'party' ? (t === S.myColor ? 'Your move' : "Friend's move") : `${NAMES[t]} to move`;
  return [S.chess.inCheck() ? `${who} — check!` : who, false];
}

function winnerText(w) {
  if (S.mode === 'party') return w === S.myColor ? 'You won' : 'Your friend won';
  return `${NAMES[w]} won`;
}

function renderSide() {
  const bottom = S.orientation, top = bottom === 'w' ? 'b' : 'w';
  $('#bar-top').innerHTML = playerBar(top);
  $('#bar-bottom').innerHTML = playerBar(bottom);

  const [txt, warn] = statusText();
  const st = $('#status'); st.textContent = txt; st.classList.toggle('warn', warn);

  const hist = S.chess.history();
  const mv = $('#moves');
  if (!hist.length) mv.innerHTML = '<div class="empty">No moves yet</div>';
  else {
    let h = '';
    for (let i = 0; i < hist.length; i += 2) {
      const last = hist.length - 1;
      h += `<div class="row"><span class="num">${i / 2 + 1}.</span><span class="mv${i === last ? ' last' : ''}">${hist[i]}</span>` +
        `<span class="mv${i + 1 === last ? ' last' : ''}">${hist[i + 1] || ''}</span></div>`;
    }
    mv.innerHTML = h;
    mv.scrollTop = mv.scrollHeight;
  }

  const party = S.mode === 'party';
  $('#panel-title').textContent = party ? 'Party game' : 'Play on this screen';
  $('#hint-pre').classList.toggle('hidden', !party);
  const chip = $('#code-chip');
  chip.classList.toggle('hidden', !party || !S.party.code);
  chip.textContent = S.party.code || '';

  const resign = $('#btn-resign');
  resign.disabled = !!S.result || (party && !S.party.oppSeated) || (!party && hist.length === 0);
  if (resign.disabled) resetResign();

  const again = $('#btn-again');
  if (party) {
    again.textContent = S.party.rematchMe ? 'Rematch sent…' : S.party.rematchThem ? 'Accept rematch' : 'Rematch';
    again.disabled = !S.result || S.party.rematchMe || !S.party.oppSeated;
  } else { again.textContent = 'New game'; again.disabled = false; }
  if (S.result && !$('#modal').classList.contains('hidden')) fillModal();
}

// ---------- Game over ----------
function fillModal() {
  const r = S.result;
  let title, icon = '🏆';
  if (!r.winner) { title = 'Draw'; icon = '🤝'; }
  else { title = winnerText(r.winner); if (S.mode === 'party' && r.winner !== S.myColor) icon = '😵'; }
  $('#modal-title').textContent = title;
  $('#modal-sub').textContent = `by ${r.reason}`;
  $('#modal-icon').textContent = icon;
  const a = $('#modal-again');
  if (S.mode === 'party') {
    a.textContent = S.party.rematchMe ? 'Rematch sent…' : S.party.rematchThem ? 'Accept rematch' : 'Rematch';
    a.disabled = S.party.rematchMe || !S.party.oppSeated;
  } else { a.textContent = 'New game'; a.disabled = false; }
}
function gameOver() {
  clearPremoves(); clearSel();
  sound('end');
  fillModal();
  setTimeout(() => { if (S.result) $('#modal').classList.remove('hidden'); }, 250);
  render();
}
function hideModal() { $('#modal').classList.add('hidden'); }
$('#modal-x').onclick = hideModal;
$('#modal-view').onclick = hideModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') hideModal(); });
$('#modal-again').onclick = () => playAgain();
$('#btn-again').onclick = () => playAgain();

function playAgain() {
  if (S.mode === 'local') { newLocalGame(); hideModal(); }
  else { send({ type: 'rematch' }); }
}

let resignTimer = null;
function resetResign() { const b = $('#btn-resign'); b.textContent = '🏳️ Resign'; b.classList.remove('danger'); clearTimeout(resignTimer); }
$('#btn-resign').onclick = () => {
  const b = $('#btn-resign');
  if (!b.classList.contains('danger')) {
    b.textContent = 'Click again to resign'; b.classList.add('danger');
    resignTimer = setTimeout(resetResign, 3000);
    return;
  }
  resetResign();
  if (S.mode === 'local') {
    S.result = { winner: turn() === 'w' ? 'b' : 'w', reason: 'resignation' };
    saveLocal();
    gameOver();
  } else send({ type: 'resign' });
};

// ---------- Sounds (made with Web Audio, no files needed) ----------
let actx = null;
function ctx() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } return actx; }
function blip(freq, dur, vol = 0.25, type = 'sine', delay = 0) {
  const a = ctx(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
}
function knock(vol = 0.5, dur = 0.06, freq = 900) {
  const a = ctx(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2; g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination); src.start();
}
function soundFor(mv) {
  if (S.chess.inCheck()) return 'check';
  if (mv.captured) return 'capture';
  if (mv.san.startsWith('O-O')) return 'castle';
  return 'move';
}
function sound(kind) {
  if (document.hidden && kind !== 'end') return;
  switch (kind) {
    case 'move': knock(0.9, 0.07, 700); break;
    case 'capture': knock(1.1, 0.09, 1300); knock(0.6, 0.06, 500); break;
    case 'castle': knock(0.9, 0.06, 700); setTimeout(() => knock(0.8, 0.06, 800), 90); break;
    case 'check': knock(0.9, 0.07, 800); blip(880, 0.18, 0.12, 'triangle', 0.03); break;
    case 'premove': knock(0.35, 0.04, 1800); break;
    case 'end': blip(523, 0.25, 0.15, 'triangle'); blip(659, 0.25, 0.15, 'triangle', 0.12); blip(784, 0.4, 0.15, 'triangle', 0.24); break;
  }
}

// ---------- Screens ----------
function show(screen) {
  $('#lobby').classList.toggle('hidden', screen !== 'lobby');
  $('#game').classList.toggle('hidden', screen !== 'game');
}

function resetBoardState() {
  S.chess = new Chess(); S.result = null; S.lastMove = null;
  clearSel(); clearPremoves(); cancelDrag(); S.promo = null; S.arrows = []; S.marks.clear();
  hideModal(); resetResign();
}

// Local mode
function saveLocal() {
  ss.set('cp_local', JSON.stringify({ moves: S.chess.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, promotion: m.promotion })), result: S.result }));
}
function startLocal(restore) {
  leaveParty();
  resetBoardState();
  S.mode = 'local'; S.orientation = 'w';
  if (restore) {
    try {
      const d = JSON.parse(restore);
      for (const m of d.moves) S.chess.move(m);
      const h = S.chess.history({ verbose: true }); const l = h[h.length - 1];
      if (l) S.lastMove = { from: l.from, to: l.to };
      S.result = d.result || resultOf(S.chess);
    } catch { S.chess = new Chess(); }
  }
  ss.set('cp_mode', 'local');
  saveLocal();
  show('game'); render();
}
function newLocalGame() { resetBoardState(); saveLocal(); sound('move'); render(); }

// ---------- Party (WebSocket) ----------
let ws = null, retry = 0, retryTimer = null;
function wsUrl() { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`; }
function connect(then) {
  clearTimeout(retryTimer);
  const sock = new WebSocket(wsUrl());
  ws = sock;
  sock.onopen = () => { retry = 0; S.party.connected = true; then && then(); if (S.mode === 'party') render(); };
  sock.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; S.party.connected = false;
    if (S.mode === 'party' && S.party.code) {
      render();
      retryTimer = setTimeout(() => connect(() => send({ type: 'join', code: S.party.code, token: TOKEN })), Math.min(4000, 400 * 2 ** retry++));
    } else if (pendingLobby) { lobbyError("Couldn't reach the server. Is it running?"); pendingLobby = false; }
  };
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function withSocket(fn) { if (ws && ws.readyState === 1) fn(); else connect(fn); }

let pendingLobby = false;
function createParty() { lobbyError(''); pendingLobby = true; withSocket(() => send({ type: 'create', token: TOKEN })); }
function joinParty(code) {
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LEN) return lobbyError(`Codes are ${CODE_LEN} characters long.`);
  lobbyError(''); pendingLobby = true;
  withSocket(() => send({ type: 'join', code, token: TOKEN }));
}
function leaveParty() {
  if (S.mode === 'party') send({ type: 'leave' });
  S.party.code = null; ss.del('cp_code');
  if (ws) { const w = ws; ws = null; w.close(); }
  S.party.connected = false;
  if (location.hash) history.replaceState(null, '', location.pathname);
}

function onMessage(m) {
  if (m.type === 'error') {
    pendingLobby = false;
    if (S.mode === 'party' && m.fatal) {
      toast(m.msg);
      S.mode = null; leaveParty(); show('lobby');
    } else if (S.mode !== 'party') { lobbyError(m.msg); S.party.code = null; ss.del('cp_code'); ss.del('cp_mode'); }
    else toast(m.msg);
    return;
  }
  if (m.type === 'state') onState(m);
}

function onState(s) {
  pendingLobby = false;
  if (S.mode !== 'party') {
    resetBoardState();
    S.mode = 'party'; S.party.gameNo = -1;
    ss.set('cp_mode', 'party');
    show('game');
  }
  const P = S.party;
  P.code = s.code; ss.set('cp_code', s.code);
  if (location.hash !== '#' + s.code) history.replaceState(null, '', '#' + s.code);
  const hadOpp = P.oppSeated;
  P.oppSeated = s.oppSeated; P.oppHere = s.oppHere; P.rematchMe = s.rematch.me; P.rematchThem = s.rematch.them;
  if (!hadOpp && s.oppSeated && P.gameNo !== -1) sound('move');

  const newGame = s.gameNo !== P.gameNo;
  if (newGame) {
    resetBoardState();
    P.gameNo = s.gameNo;
    S.myColor = s.color; S.orientation = s.color;
  }
  const local = S.chess.history({ verbose: true });
  const same = local.length === s.moves.length && local.every((m, i) => m.from === s.moves[i].from && m.to === s.moves[i].to);
  let arrived = null;
  if (!same) {
    const c = new Chess(); let last = null;
    for (const m of s.moves) last = c.move({ from: m.from, to: m.to, promotion: m.promotion });
    if (!newGame && s.moves.length === local.length + 1) arrived = last;
    S.chess = c;
    S.lastMove = last ? { from: last.from, to: last.to } : null;
  }
  const hadResult = !!S.result;
  S.result = s.result;
  if (arrived) sound(soundFor(arrived));
  refreshSelection();
  render(arrived);
  if (S.result && !hadResult && !newGame) gameOver();
  else if (S.result && newGame && s.moves.length) { fillModal(); }
  if (arrived) setTimeout(tryPremove, 80);
}

// ---------- Lobby wiring ----------
function lobbyError(t) { $('#lobby-error').textContent = t; }
$('#btn-local').onclick = () => startLocal();
$('#btn-create').onclick = () => createParty();
$('#join-form').onsubmit = (e) => { e.preventDefault(); joinParty($('#join-code').value); };
$('#join-code').addEventListener('input', (e) => {
  const allowed = new Set(CODE_CHARS);
  e.target.value = [...e.target.value.toUpperCase()].filter((ch) => allowed.has(ch)).join('').slice(0, CODE_LEN);
});
$('#btn-menu').onclick = () => { leaveParty(); S.mode = null; ss.del('cp_mode'); ss.del('cp_local'); resetBoardState(); show('lobby'); };
$('#logo').onclick = (e) => { e.preventDefault(); $('#btn-menu').click(); };
$('#code-chip').onclick = () => copy(S.party.code);

function copy(text) {
  const done = () => toast('Copied!');
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => toast(text));
  else toast(text);
}
let toastTimer = null;
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

// Rejoin after a refresh, or follow an invite link like /#XYG34.
(function boot() {
  const hash = location.hash.slice(1).toUpperCase();
  const savedCode = ss.get('cp_code');
  if (ss.get('cp_mode') === 'party' && savedCode) {
    S.party.code = savedCode;
    pendingLobby = true;
    connect(() => send({ type: 'join', code: savedCode, token: TOKEN }));
  } else if (hash.length === CODE_LEN) {
    $('#join-code').value = hash;
    joinParty(hash);
  } else if (ss.get('cp_mode') === 'local') {
    startLocal(ss.get('cp_local'));
  }
})();

window.__S = S; // handy for debugging
