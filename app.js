'use strict';

/* =====================================================================
   CubeLab — 3x3 Rubik's Cube simulator
   Coordinate system (CSS-native): +x right, +y down, +z toward viewer.
   Each cubie keeps an integer grid position and a 3x3 integer
   orientation matrix. Turns rotate a layer by reparenting the cubies
   into a pivot <div>, animating it, then "baking" the rotation back
   into every affected cubie.
   ===================================================================== */

/* ---------- linear algebra (integer, 90° multiples) ---------- */
const r0 = Math.round;
function matMul(a, b) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i][k] * b[k][j];
      m[i][j] = s;
    }
  return m;
}
function matVec(m, v) {
  return [0, 1, 2].map(i => r0(m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]));
}
function rotMat(axis, deg) {
  const a = (deg * Math.PI) / 180, c = r0(Math.cos(a)), s = r0(Math.sin(a));
  const [x, y, z] = axis, t = 1 - c;
  return [
    [r0(c + x * x * t), r0(x * y * t - z * s), r0(x * z * t + y * s)],
    [r0(y * x * t + z * s), r0(c + y * y * t), r0(y * z * t - x * s)],
    [r0(z * x * t - y * s), r0(z * y * t + x * s), r0(c + z * z * t)],
  ];
}
const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const isIdent = m =>
  m[0][0] === 1 && m[1][1] === 1 && m[2][2] === 1 &&
  m[0][1] === 0 && m[0][2] === 0 && m[1][0] === 0 &&
  m[1][2] === 0 && m[2][0] === 0 && m[2][1] === 0;

/* ---------- configuration ---------- */
const UNIT = 60;                       // distance between cubie centres (px)
const COL = {
  U: getVar('--c-U'), D: getVar('--c-D'), F: getVar('--c-F'),
  B: getVar('--c-B'), L: getVar('--c-L'), R: getVar('--c-R'), X: '#141414',
};
function getVar(n) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
}

// Move -> rotation axis vector, which cubies it grabs, and the sign that
// makes the plain letter a clockwise turn when looking at that face.
const MOVES = {
  // outer faces
  U: { v: [0, 1, 0], pick: g => g[1] === -1, sign: -1 },
  D: { v: [0, 1, 0], pick: g => g[1] === 1, sign: 1 },
  R: { v: [1, 0, 0], pick: g => g[0] === 1, sign: -1 },
  L: { v: [1, 0, 0], pick: g => g[0] === -1, sign: 1 },
  F: { v: [0, 0, 1], pick: g => g[2] === 1, sign: -1 },
  B: { v: [0, 0, 1], pick: g => g[2] === -1, sign: 1 },
  // middle slices  (M follows L, E follows D, S follows F)
  M: { v: [1, 0, 0], pick: g => g[0] === 0, sign: 1 },
  E: { v: [0, 1, 0], pick: g => g[1] === 0, sign: 1 },
  S: { v: [0, 0, 1], pick: g => g[2] === 0, sign: -1 },
  // wide turns (outer layer + adjacent slice)
  u: { v: [0, 1, 0], pick: g => g[1] <= 0, sign: -1 },
  d: { v: [0, 1, 0], pick: g => g[1] >= 0, sign: 1 },
  r: { v: [1, 0, 0], pick: g => g[0] >= 0, sign: -1 },
  l: { v: [1, 0, 0], pick: g => g[0] <= 0, sign: 1 },
  f: { v: [0, 0, 1], pick: g => g[2] >= 0, sign: -1 },
  b: { v: [0, 0, 1], pick: g => g[2] <= 0, sign: 1 },
  // whole-cube rotations
  x: { v: [1, 0, 0], pick: () => true, sign: -1, whole: true },
  y: { v: [0, 1, 0], pick: () => true, sign: -1, whole: true },
  z: { v: [0, 0, 1], pick: () => true, sign: -1, whole: true },
};

/* ---------- DOM ---------- */
const $ = s => document.querySelector(s);
const cubeEl = $('#cube');
const stage = $('#stage');
const timerEl = $('#timer');
const timerState = $('#timer-state');
const movesEl = $('#moves');
const scrambleEl = $('#scramble');
const historyEl = $('#history');

/* ---------- cube construction ---------- */
let cubies = [];
function buildCube() {
  cubeEl.innerHTML = '';
  cubies = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const el = document.createElement('div');
        el.className = 'cubie';
        const stickers = [];
        const put = (cls, on, dir, color) => {
          addFace(el, cls, on ? color : COL.X, on ? dir : null);
          if (on) stickers.push({ d: dir, c: color });
        };
        put('u', y === -1, [0, -1, 0], COL.U);
        put('d', y === 1, [0, 1, 0], COL.D);
        put('r', x === 1, [1, 0, 0], COL.R);
        put('l', x === -1, [-1, 0, 0], COL.L);
        put('f', z === 1, [0, 0, 1], COL.F);
        put('bk', z === -1, [0, 0, -1], COL.B);
        el._stickers = stickers;
        el._solved = [x, y, z];
        el._grid = [x, y, z];
        el._ori = IDENT.map(r => r.slice());
        cubeEl.appendChild(el);
        cubies.push(el);
        renderCubie(el);
      }
}
function addFace(parent, cls, color, localDir) {
  const f = document.createElement('div');
  f.className = 'face ' + cls + (localDir ? ' sticker' : '');
  f.style.background = color;
  if (localDir) {
    f._cubie = parent;
    f._localDir = localDir;
  }
  parent.appendChild(f);
}
function renderCubie(el) {
  const [gx, gy, gz] = el._grid, m = el._ori;
  el.style.transform =
    `matrix3d(${m[0][0]},${m[1][0]},${m[2][0]},0,` +
    `${m[0][1]},${m[1][1]},${m[2][1]},0,` +
    `${m[0][2]},${m[1][2]},${m[2][2]},0,` +
    `${gx * UNIT},${gy * UNIT},${gz * UNIT},1)`;
}

/* ---------- turn engine ---------- */
let speedMs = 260;
let queue = [];
let running = false;

function onceEvent(el, ev, timeout) {
  return new Promise(res => {
    let done = false;
    const h = () => { if (done) return; done = true; el.removeEventListener(ev, h); res(); };
    el.addEventListener(ev, h);
    setTimeout(h, timeout);
  });
}

function parseToken(tok) {
  return { base: tok[0], prime: tok.includes("'"), dbl: tok.includes('2') };
}
function invertToken(tok) {
  if (tok.includes('2')) return tok;
  return tok.includes("'") ? tok[0] : tok[0] + "'";
}

function bake(layer, R) {
  layer.forEach(c => {
    c._ori = matMul(R, c._ori);
    c._grid = matVec(R, c._grid);
    renderCubie(c);
  });
}

async function doTurn(tok, opt) {
  opt = opt || {};
  const { base, prime, dbl } = parseToken(tok);
  const spec = MOVES[base];
  if (!spec) return;

  const deg = (dbl ? 180 : 90) * spec.sign * (prime ? -1 : 1);
  const R = rotMat(spec.v, deg);
  const layer = cubies.filter(c => spec.pick(c._grid));

  const ms = opt.fast ? Math.min(120, speedMs) : speedMs;
  const animate = document.visibilityState !== 'hidden' && ms >= 24;

  if (animate) {
    const pivot = document.createElement('div');
    pivot.className = 'layer';
    cubeEl.appendChild(pivot);
    layer.forEach(c => pivot.appendChild(c));

    pivot.style.transition = 'none';
    pivot.style.transform = 'rotate3d(1,0,0,0deg)';
    void pivot.offsetWidth; // commit the starting state before transitioning

    pivot.style.transition = `transform ${ms}ms cubic-bezier(.32,.72,.28,1)`;
    pivot.style.transform =
      `rotate3d(${spec.v[0]},${spec.v[1]},${spec.v[2]},${deg}deg)`;

    await onceEvent(pivot, 'transitionend', ms + 120);

    bake(layer, R);
    layer.forEach(c => cubeEl.appendChild(c));
    pivot.remove();
  } else {
    bake(layer, R);
  }

  afterTurn(tok, spec, opt);
}

function enqueue(tokens, opt) {
  tokens.forEach(t => queue.push([t, opt || {}]));
  pump();
}
async function pump() {
  if (running) return;
  running = true;
  syncButtons();
  while (queue.length) {
    const [tok, opt] = queue.shift();
    if (tok === '@arm') { armed = true; setState('Armed — first move starts timer'); continue; }
    await doTurn(tok, opt);
  }
  running = false;
  syncButtons();
}

/* ---------- solve / timer state ---------- */
let moveCount = 0;
let history = [];        // user-visible moves (for the log + counter)
let applied = [];        // every layer move since solved (scramble + user) — drives Auto-Solve
let armed = false;
let timerRunning = false;
let startT = 0;

function afterTurn(tok, spec, opt) {
  if (!spec.whole && !opt.solving && !opt.undo) applied.push(tok);

  if (!opt.silent && !spec.whole) {
    moveCount++;
    movesEl.textContent = moveCount;
    history.push(tok);
    renderHistory();
    if (armed && !timerRunning) {
      timerRunning = true;
      startT = performance.now();
      timerEl.classList.add('run');
      setState('Solving…');
    }
  }

  if (cubeSolved()) {
    applied = [];
    if (timerRunning) {
      timerRunning = false;
      armed = false;
      const t = performance.now() - startT;
      timerEl.classList.remove('run');
      timerEl.classList.add('done');
      timerEl.textContent = fmtTime(t);
      setState('Solved in ' + moveCount + ' moves');
      addTime(t);
    } else if (!opt.silent || opt.solving) {
      setState('Solved');
    }
  }
  syncButtons();
}

function cubeSolved() {
  const buckets = {};
  for (const el of cubies) {
    for (const s of el._stickers) {
      const n = matVec(el._ori, s.d).join(',');
      (buckets[n] = buckets[n] || []).push(s.c);
    }
  }
  const faces = Object.values(buckets);
  return faces.length === 6 && faces.every(a => a.length === 9 && a.every(c => c === a[0]));
}
function setState(txt) { timerState.textContent = txt; }

function renderHistory() {
  if (!history.length) { historyEl.innerHTML = '<span class="muted">No moves yet.</span>'; return; }
  historyEl.innerHTML = history
    .slice(-60)
    .map(t => `<span class="mv">${pretty(t)}</span>`)
    .join('');
  historyEl.scrollTop = historyEl.scrollHeight;
}
function pretty(t) {
  return t.replace("'", '′').replace('2', '²');
}

/* ---------- scramble ---------- */
function genScramble(n) {
  const faces = ['U', 'D', 'L', 'R', 'F', 'B'];
  const suffix = ['', "'", '2'];
  const axis = { U: 0, D: 0, L: 1, R: 1, F: 2, B: 2 };
  const out = [];
  let prevAxis = -1, prevPrevAxis = -1;
  while (out.length < n) {
    const f = faces[(Math.random() * 6) | 0];
    const a = axis[f];
    if (a === prevAxis) continue;
    if (a === prevPrevAxis && prevAxis !== -1) { /* allow, but keep variety */ }
    out.push(f + suffix[(Math.random() * 3) | 0]);
    prevPrevAxis = prevAxis;
    prevAxis = a;
  }
  return out;
}

function resetInstant() {
  cubies.forEach(c => {
    c._grid = c._solved.slice();
    c._ori = IDENT.map(r => r.slice());
    renderCubie(c);
  });
}

function actionScramble() {
  if (running) return;
  resetInstant();
  const seq = genScramble(23);
  scrambleEl.innerHTML = seq.map(pretty).join('&nbsp; ');
  moveCount = 0; movesEl.textContent = 0;
  history = []; applied = []; renderHistory();
  timerRunning = false; armed = false;
  timerEl.classList.remove('run', 'done');
  timerEl.textContent = '0.00';
  setState('Scrambling…');
  enqueue(seq, { silent: true, fast: true });
  queue.push(['@arm', {}]);
  pump();
}

function actionUndo() {
  if (running || !history.length) return;
  const last = history.pop();
  applied.pop();
  moveCount = Math.max(0, moveCount - 1);
  movesEl.textContent = moveCount;
  renderHistory();
  enqueue([invertToken(last)], { silent: true, undo: true });
}

function actionReset() {
  if (running) return;
  resetInstant();
  moveCount = 0; movesEl.textContent = 0;
  history = []; applied = []; renderHistory();
  armed = false; timerRunning = false;
  timerEl.classList.remove('run', 'done');
  timerEl.textContent = '0.00';
  scrambleEl.innerHTML = 'Press <b>Scramble</b> to generate a random state.';
  setState('Ready');
}

function actionSolve() {
  if (running || !applied.length) return;
  const seq = applied.slice().reverse().map(invertToken);
  applied = []; history = [];
  moveCount = 0; movesEl.textContent = 0;
  armed = false; timerRunning = false;
  timerEl.classList.remove('run', 'done');
  timerEl.textContent = '0.00';
  renderHistory();
  setState('Auto‑solving…');
  enqueue(seq, { silent: true, solving: true });
}

/* ---------- times / stats ---------- */
const KEY = 'cubelab.times.v1';
let times = loadTimes();
function loadTimes() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
}
function saveTimes() {
  try { localStorage.setItem(KEY, JSON.stringify(times)); } catch (e) {}
}
function addTime(ms) {
  times.push(Math.round(ms));
  saveTimes();
  renderTimes();
}
function fmtTime(ms) {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(2);
  const m = Math.floor(s / 60);
  return m + ':' + (s % 60).toFixed(2).padStart(5, '0');
}
function averageOf(arr, k) {
  if (arr.length < k) return '—';
  const w = arr.slice(-k).slice().sort((a, b) => a - b);
  const mid = w.slice(1, -1);
  return fmtTime(mid.reduce((a, b) => a + b, 0) / mid.length);
}
function renderTimes() {
  $('#stat-best').textContent = times.length ? fmtTime(Math.min(...times)) : '—';
  $('#stat-ao5').textContent = averageOf(times, 5);
  $('#stat-count').textContent = times.length;
  $('#times').innerHTML = times
    .map((t, i) => ({ t, i }))
    .reverse()
    .map(o => `<li><span>#${o.i + 1}</span><b>${fmtTime(o.t)}</b></li>`)
    .join('');
}

/* ---------- camera ---------- */
let camX = -27, camY = -37, zoom = 1.45;
let dragging = false, lastX = 0, lastY = 0;
let autoRotate = false;
let pointerAction = null;
const gestureMoveEl = $('#gesture-move');

function applyCam() {
  cubeEl.style.setProperty('--cx', camX + 'deg');
  cubeEl.style.setProperty('--cy', camY + 'deg');
}
function applyZoom() {
  $('#viewport').style.setProperty('--zoom', zoom.toFixed(3));
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// Project a world-space direction through the cube camera into screen space.
// CSS applies rotateY first, followed by rotateX for the transform used here.
function projectDirection(v) {
  const ay = camY * Math.PI / 180, ax = camX * Math.PI / 180;
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const x = cy * v[0] + sy * v[2];
  const z = -sy * v[0] + cy * v[2];
  const y = cx * v[1] - sx * z;
  return [x, y];
}

function layerBase(axisIndex, coord) {
  if (axisIndex === 0) return coord === 1 ? 'R' : coord === -1 ? 'L' : 'M';
  if (axisIndex === 1) return coord === -1 ? 'U' : coord === 1 ? 'D' : 'E';
  return coord === 1 ? 'F' : coord === -1 ? 'B' : 'S';
}

function swipeMove(sticker, dx, dy) {
  const cubie = sticker._cubie;
  if (!cubie || !sticker._localDir) return null;

  const len = Math.hypot(dx, dy);
  if (len < 18) return null;
  const drag = [dx / len, dy / len];
  const normal = matVec(cubie._ori, sticker._localDir);
  const point = cubie._grid.map((g, i) => g * UNIT + normal[i] * 30);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let best = null;

  axes.forEach((axis, axisIndex) => {
    if (normal[axisIndex] !== 0) return;
    const screen = projectDirection(cross(axis, point));
    const screenLen = Math.hypot(screen[0], screen[1]);
    if (screenLen < .001) return;
    const dot = drag[0] * screen[0] / screenLen + drag[1] * screen[1] / screenLen;
    const score = Math.abs(dot);
    if (!best || score > best.score) best = { axisIndex, dot, score };
  });

  if (!best || best.score < .52) return null;
  const base = layerBase(best.axisIndex, cubie._grid[best.axisIndex]);
  const desiredSign = best.dot >= 0 ? 1 : -1;
  return base + (desiredSign === MOVES[base].sign ? '' : "'");
}

function showGesturePreview(tok) {
  clearGesturePreview();
  const spec = MOVES[parseToken(tok).base];
  cubies.filter(c => spec.pick(c._grid)).forEach(c => c.classList.add('gesture-preview'));
  gestureMoveEl.textContent = pretty(tok);
  gestureMoveEl.hidden = false;
  stage.classList.add('turn-intent');
}

function clearGesturePreview() {
  cubies.forEach(c => c.classList.remove('gesture-preview'));
  gestureMoveEl.hidden = true;
  stage.classList.remove('turn-intent');
}

stage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  const sticker = e.target.closest('.face.sticker');
  pointerAction = {
    id: e.pointerId,
    mode: sticker && !e.altKey && !running ? 'turn' : 'orbit',
    sticker,
    startX: e.clientX,
    startY: e.clientY,
    token: null,
  };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', e => {
  if (!dragging || !pointerAction || pointerAction.id !== e.pointerId) return;
  if (pointerAction.mode === 'turn') {
    if (!pointerAction.token) {
      const tok = swipeMove(
        pointerAction.sticker,
        e.clientX - pointerAction.startX,
        e.clientY - pointerAction.startY
      );
      if (tok) {
        pointerAction.token = tok;
        showGesturePreview(tok);
      }
    }
    return;
  }
  camY += (e.clientX - lastX) * 0.38;
  camX -= (e.clientY - lastY) * 0.38;
  camX = Math.max(-88, Math.min(88, camX));
  lastX = e.clientX; lastY = e.clientY;
  applyCam();
});
stage.addEventListener('dblclick', () => {
  camX = -27; camY = -37; zoom = 1.45;
  applyCam(); applyZoom();
});
function finishPointer(e, commit) {
  if (!pointerAction || pointerAction.id !== e.pointerId) return;
  const tok = pointerAction.token;
  dragging = false;
  pointerAction = null;
  clearGesturePreview();
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  if (commit && tok) enqueue([tok], {});
}
stage.addEventListener('pointerup', e => finishPointer(e, true));
stage.addEventListener('pointercancel', e => finishPointer(e, false));
stage.addEventListener('wheel', e => {
  e.preventDefault();
  zoom = Math.max(0.55, Math.min(1.9, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
  applyZoom();
}, { passive: false });

/* ---------- animation loop ---------- */
function frame() {
  if (autoRotate && !dragging && !running) {
    camY += 0.14;
    applyCam();
  }
  if (timerRunning) {
    timerEl.textContent = fmtTime(performance.now() - startT);
  }
  requestAnimationFrame(frame);
}

/* ---------- input wiring ---------- */
$('#pad').addEventListener('click', e => {
  const b = e.target.closest('button[data-m]');
  if (b) enqueue([b.dataset.m], {});
});
$('#btn-scramble').addEventListener('click', actionScramble);
$('#btn-undo').addEventListener('click', actionUndo);
$('#btn-reset').addEventListener('click', actionReset);
$('#btn-solve').addEventListener('click', actionSolve);
$('#btn-clear-times').addEventListener('click', () => {
  times = []; saveTimes(); renderTimes();
});

const speedNames = { 1: 'Very slow', 2: 'Very slow', 3: 'Slow', 4: 'Slow', 5: 'Relaxed', 6: 'Normal', 7: 'Brisk', 8: 'Fast', 9: 'Very fast', 10: 'Instant' };
$('#speed').addEventListener('input', e => {
  const v = +e.target.value;
  speedMs = Math.round(540 - v * 48);
  $('#speed-val').textContent = speedNames[v] || 'Normal';
});

$('#autorotate').addEventListener('change', e => { autoRotate = e.target.checked; });

const help = $('#help');
$('#btn-help').addEventListener('click', () => { help.hidden = false; });
$('#btn-help-close').addEventListener('click', () => { help.hidden = true; });
help.addEventListener('click', e => { if (e.target === help) help.hidden = true; });

window.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { help.hidden = true; return; }
  if (k === ' ') { e.preventDefault(); actionScramble(); return; }
  if (k === 'backspace') { e.preventDefault(); actionUndo(); return; }
  const map = {
    u: 'U', d: 'D', l: 'L', r: 'R', f: 'F', b: 'B',
    m: 'M', e: 'E', s: 'S', x: 'x', y: 'y', z: 'z',
  };
  if (map[k]) {
    e.preventDefault();
    const base = map[k];
    enqueue([e.shiftKey ? base + "'" : base], {});
  }
});

function syncButtons() {
  $('#btn-scramble').disabled = running;
  $('#btn-reset').disabled = running;
  $('#btn-undo').disabled = running || !history.length;
  $('#btn-solve').disabled = running || !applied.length;
}

/* ---------- boot ---------- */
buildCube();
applyCam();
applyZoom();
renderTimes();
syncButtons();
$('#speed-val').textContent = 'Normal';
requestAnimationFrame(frame);
