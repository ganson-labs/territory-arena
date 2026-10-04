// «Сонет»: планировщик петель.
//
// Каждый ход бот перебирает кандидатов — цепочки путевых точек от головы до возвращения домой —
// и прогоняет каждого точной копией правил движка: хвост, самопересечение, стены, замыкание, захват
// (заливка от края поля, как в enclosure() движка). Выбирает кандидата по приросту клеток
// (отнятая у соперника земля считается дважды) за время петли плюс накладные расходы.
//
// Безопасность. Соперник (по Дубинсу, с учётом радиуса поворота ~48) не должен успеть добраться до
// любой клетки моего хвоста, пока я не вернусь домой, иначе кандидат отбрасывается. Тот же расчёт
// даёт безопасный отход: если соперник приблизился, лучшим становится самый скорый возврат.
//
// Нападение. Если до клетки хвоста соперника я успею раньше, чем он вернётся на свою землю,
// это кандидат «убийство»: он стоит всей земли соперника.
//
// Топтание. Когда безопасной петли нет, бот кружит в глубине своей земли и не выходит ради крох.
//
// Конец раунда. Выбор учитывает, сколько ещё успеем набрать после петли; в последние секунды
// остаётся только то, что успевает замкнуться.

const WIDTH = 1600;
const HEIGHT = 1000;
const CELL = 10;
const COLS = 160;
const ROWS = 100;
const N = COLS * ROWS;
const STEP = 10;
const TURN = 12;
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const RT = STEP / (2 * Math.sin((TURN * RAD) / 2)); // радиус самого крутого виража, ~47.8
const GRACE = 4;
const REACH = 30;
const BASE_R = 60;

// ---- настройки (подобраны самоигрой: бот против своих вариантов, по 144 раунда на замер)
const CFG = {
  margin: 5, // запас безопасности в ходах: враг должен опаздывать к моему хвосту минимум на столько
  earlyTicks: 250, // в начале матча терять нечего — идём на риск
  earlyMargin: -15,
  killMargin: 2, // насколько раньше соперника я обязан успеть к его хвосту
  earlyKillTicks: 400,
  earlyKillMargin: -4,
  over: 250, // накладные расходы на петлю (в ходах): делает выгодными большие петли
  minValue: 50, // петли меньше этого не стоят выхода с земли
  pointless: 30,
  wait: 8, // топтание на месте считается коротким ожиданием
  hoverT: 45,
  hyst: 1.06,
  killBonus: 140,
  stealW: 1.0, // отнятая у соперника клетка считается дважды
  tail: 25, // минимум ходов, которых хватит ещё на одну петлю
  restW: 1.0,
  reach: 30,
  headK: 30, // на сколько ходов вперёд проверять лоб в лоб
  headOffset: 3,
  scale: 3, // во сколько раз больше кандидатов за ход (границу ставит дедлайн на ход)
};

// Для песочницы: переопределение настроек через окружение (в турнире не задействовано).
(function applyOverrides() {
  try {
    if (typeof process === 'undefined' || !process.env) return;
    let inst = null;
    try { inst = new URL(import.meta.url).searchParams.get('instance'); } catch {}
    for (const k of ['BOT_CFG', inst !== null ? 'BOT_CFG' + inst : null]) {
      if (k && process.env[k]) Object.assign(CFG, JSON.parse(process.env[k]));
    }
  } catch {}
})();

// ---- вспомогательное
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SCALE = typeof process !== 'undefined' && process.env && process.env.BOT_SCALE ? Number(process.env.BOT_SCALE) : 1;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const SEED = typeof process !== 'undefined' && process.env && process.env.BOT_SEED ? Number(process.env.BOT_SEED) : 0;
let rnd = mulberry32(12345);
const rr = (a, b) => a + (b - a) * rnd();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function adiff(t, f) {
  let d = (t - f) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
const cellOf = (x, y) => Math.floor(y / CELL) * COLS + Math.floor(x / CELL);
const cx_ = (c) => (c % COLS) * CELL + CELL / 2;
const cy_ = (c) => Math.floor(c / COLS) * CELL + CELL / 2;

// Минимум ходов, чтобы из позы (px,py,курс h) доехать до точки (tx,ty) с радиусом поворота RT.
function dubTicks(px, py, h, tx, ty) {
  const hr = h * RAD;
  const c = Math.cos(hr);
  const s = Math.sin(hr);
  const dx = tx - px;
  const dy = ty - py;
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  let best = Infinity;
  for (let k = 0; k < 2; k++) {
    const vv = k === 0 ? v : -v;
    const wy = vv - RT;
    const d2 = u * u + wy * wy;
    if (d2 < RT * RT) continue;
    const d = Math.sqrt(d2);
    let th = Math.atan2(wy, u) - Math.acos(RT / d) + Math.PI / 2;
    th = ((th % TAU) + TAU) % TAU;
    const len = RT * th + Math.sqrt(d2 - RT * RT);
    if (len < best) best = len;
  }
  if (best === Infinity) best = Math.hypot(dx, dy) + RT * 2;
  return best / STEP;
}

// Можно ли из позы уйти от края поля виражом (хотя бы один из двух крутых кругов целиком внутри поля).
function canTurnAway(x, y, h) {
  const hr = h * RAD;
  const nxv = -Math.sin(hr) * RT;
  const nyv = Math.cos(hr) * RT;
  const m = 3;
  for (let k = -1; k <= 1; k += 2) {
    const cx = x + nxv * k;
    const cy = y + nyv * k;
    if (cx >= RT + m && cx <= WIDTH - RT - m && cy >= RT + m && cy <= HEIGHT - RT - m) return true;
  }
  return false;
}

// ---- окружение хода
const E = {
  s: null, land: null, trail: null, me: null, en: null,
  tick: 0, left: 0,
  side: 0,
  enBase: new Uint8Array(N),
  myBase: new Uint8Array(N),
  nearest: new Int32Array(N),
  dist: new Int16Array(N),
  core: -1,
  deep: [],
  fresh: new Int8Array(N), // возраст свежих клеток моего хвоста + 1 (0 — не свежая)
  myTrailCells: [],
  bx0: 0, bx1: 0, by0: 0, by1: 0,
  ex: 0, ey: 0, eh: 0, edelay: 0,
  teh: 0,
  enemyTrailCells: [],
  baseCells: 113, margin: 5, killMargin: 2,
};
const teMemo = new Float32Array(N);
const teGen = new Int32Array(N);
let teStamp = 0;
const queue = new Int32Array(N);

function Te(c) {
  if (teGen[c] === teStamp) return teMemo[c];
  const v = E.edelay + dubTicks(E.ex, E.ey, E.eh, cx_(c), cy_(c)) - 0.5;
  teGen[c] = teStamp;
  teMemo[c] = v;
  return v;
}

function buildBaseMask(arr, b) {
  arr.fill(0);
  for (let i = 0; i < N; i++) {
    const dx = cx_(i) - b.x;
    const dy = cy_(i) - b.y;
    if (dx * dx + dy * dy <= b.radius * b.radius) arr[i] = 1;
  }
}

function buildEnv(s) {
  E.s = s;
  const land = (E.land = s.land);
  const trail = (E.trail = s.trail);
  const me = (E.me = s.me);
  const en = (E.en = s.enemy);
  E.tick = s.tick;
  E.left = 2400 - s.tick;
  E.margin = s.tick < CFG.earlyTicks ? CFG.earlyMargin : CFG.margin;
  E.killMargin = s.tick < CFG.earlyKillTicks ? CFG.earlyKillMargin : CFG.killMargin;
  // bbox земли + хвоста, ближайшая своя клетка (BFS от своей земли)
  let x0 = COLS, x1 = -1, y0 = ROWS, y1 = -1;
  let qh = 0, qt = 0;
  const near = E.nearest;
  near.fill(-1);
  for (let i = 0; i < N; i++) {
    if (land[i] === 1) {
      near[i] = i;
      queue[qt++] = i;
    }
    if (land[i] === 1 || trail[i] === 1) {
      const x = i % COLS;
      const y = (i / COLS) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  E.bx0 = x0; E.bx1 = x1; E.by0 = y0; E.by1 = y1;
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % COLS;
    const src = near[i];
    if (x > 0 && near[i - 1] < 0) { near[i - 1] = src; queue[qt++] = i - 1; }
    if (x < COLS - 1 && near[i + 1] < 0) { near[i + 1] = src; queue[qt++] = i + 1; }
    if (i >= COLS && near[i - COLS] < 0) { near[i - COLS] = src; queue[qt++] = i - COLS; }
    if (i < N - COLS && near[i + COLS] < 0) { near[i + COLS] = src; queue[qt++] = i + COLS; }
  }
  // «ядро» земли: клетка, наиболее удалённая от края своей земли (расстояние до чужого)
  const dist = E.dist;
  dist.fill(-1);
  qh = 0; qt = 0;
  for (let i = 0; i < N; i++) {
    if (land[i] !== 1) { dist[i] = 0; queue[qt++] = i; }
  }
  let core = -1, cd = -1;
  E.deep.length = 0;
  while (qh < qt) {
    const i = queue[qh++];
    const d = dist[i] + 1;
    const x = i % COLS;
    let j;
    if (x > 0 && dist[(j = i - 1)] < 0) { dist[j] = d; queue[qt++] = j; if (d > cd) { cd = d; core = j; } if (d >= 5 && E.deep.length < 4000) E.deep.push(j); }
    if (x < COLS - 1 && dist[(j = i + 1)] < 0) { dist[j] = d; queue[qt++] = j; if (d > cd) { cd = d; core = j; } if (d >= 5 && E.deep.length < 4000) E.deep.push(j); }
    if (i >= COLS && dist[(j = i - COLS)] < 0) { dist[j] = d; queue[qt++] = j; if (d > cd) { cd = d; core = j; } if (d >= 5 && E.deep.length < 4000) E.deep.push(j); }
    if (i < N - COLS && dist[(j = i + COLS)] < 0) { dist[j] = d; queue[qt++] = j; if (d > cd) { cd = d; core = j; } if (d >= 5 && E.deep.length < 4000) E.deep.push(j); }
  }
  E.core = core;
  // свежие клетки хвоста: последние ходы не убивают
  E.fresh.fill(0);
  const t = me.trail;
  E.myTrailCells.length = 0;
  for (let i = 0; i < N; i++) if (trail[i] === 1) E.myTrailCells.push(i);
  for (let k = Math.max(0, t.length - 6); k < t.length; k++) {
    const age = t.length - 1 - k;
    const c = cellOf(t[k].x, t[k].y);
    if (c >= 0 && c < N && trail[c] === 1) E.fresh[c] = Math.max(E.fresh[c], 1 + (GRACE - Math.min(age, GRACE)));
  }
  // соперник
  teStamp++;
  if (en.alive) {
    E.ex = en.x; E.ey = en.y; E.eh = en.heading; E.edelay = 0;
  } else {
    E.ex = en.base.x; E.ey = en.base.y; E.eh = E.side === 0 ? 180 : 0; E.edelay = en.respawnIn + 1;
  }
  // время соперника до своей земли
  E.teh = 0;
  E.enemyTrailCells.length = 0;
  if (en.alive && en.trailCells > 0) {
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      if (trail[i] === 2) E.enemyTrailCells.push(i);
      if (land[i] !== 2) continue;
      const x = i % COLS;
      if ((x > 0 && land[i - 1] !== 2) || (x < COLS - 1 && land[i + 1] !== 2) || (i >= COLS && land[i - COLS] !== 2) || (i < N - COLS && land[i + COLS] !== 2)) {
        const v = dubTicks(en.x, en.y, en.heading, cx_(i), cy_(i));
        if (v < best) best = v;
      }
    }
    E.teh = best;
  }
}

// ---- движение по правилам движка
const buf = new Int32Array(16);
function sweep(x0, y0, x1, y1) {
  let n = 0;
  let cx = Math.floor(x0 / CELL);
  let cy = Math.floor(y0 / CELL);
  for (let k = 1; k <= 4; k++) {
    const x = x0 + ((x1 - x0) * k) / 4;
    const y = y0 + ((y1 - y0) * k) / 4;
    const nx = Math.floor(x / CELL);
    const ny = Math.floor(y / CELL);
    if (nx === cx && ny === cy) continue;
    if (nx !== cx && ny !== cy) {
      if (nx >= 0 && nx < COLS && cy >= 0 && cy < ROWS) buf[n++] = cy * COLS + nx;
    }
    if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) buf[n++] = ny * COLS + nx;
    cx = nx;
    cy = ny;
  }
  return n;
}

const simGenArr = new Int32Array(N);
const simLay = new Int16Array(N);
let simGen = 0;
const seenArr = new Int32Array(N);
let seenGen = 0;
const stack = new Int32Array(N);

function simulate(wps, maxT) {
  const me = E.me;
  const land = E.land;
  const trail = E.trail;
  let x = me.x, y = me.y, h = me.heading;
  let wi = 0, wTicks = 0;
  simGen++;
  const lay = [];
  const hasOld = E.myTrailCells.length > 0;
  const r = { dead: false, closed: false, k: 0, lay, killT: -1, killCell: -1, first: 0, wi1: 0, bad: false, wp: wps, hslack: Infinity };
  for (let k = 1; k <= maxT; k++) {
    let tx, ty;
    // достигнутые точки
    while (wi < wps.length) {
      const dx = wps[wi].x - x;
      const dy = wps[wi].y - y;
      if (dx * dx + dy * dy < CFG.reach * CFG.reach) { wi++; wTicks = 0; } else break;
    }
    if (wi < wps.length) {
      tx = wps[wi].x; ty = wps[wi].y;
      if (++wTicks > 90) { r.bad = true; break; }
    } else {
      const c = E.nearest[cellOf(x, y)];
      if (c < 0) { r.bad = true; break; }
      tx = cx_(c); ty = cy_(c);
    }
    const want = Math.atan2(ty - y, tx - x) / RAD;
    const dh = clamp(adiff(want, h), -TURN, TURN);
    if (k === 1) { r.first = dh / TURN; r.wi1 = wi; }
    h += dh;
    const hr = h * RAD;
    const nx = x + Math.cos(hr) * STEP;
    const ny = y + Math.sin(hr) * STEP;
    if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) { r.dead = true; r.k = k; r.cause = 'wall'; break; }
    if (!canTurnAway(nx, ny, h)) { r.dead = true; r.k = k; r.cause = 'trap'; break; }
    const n = sweep(x, y, nx, ny);
    let died = false;
    for (let i = 0; i < n; i++) {
      const c = buf[i];
      const t = trail[c];
      if (t === 1) {
        const f = E.fresh[c];
        // f = 1 + (GRACE - age): клетка безопасна ещё (GRACE - age) ходов
        if (f === 0 || k > f - 1) { died = true; break; }
      } else if (t === 2) {
        if (r.killT < 0) { r.killT = k; r.killCell = c; }
      }
      if (simGenArr[c] === simGen && k - simLay[c] > GRACE) { died = true; break; }
    }
    if (died) { r.dead = true; r.k = k; r.cause = 'self'; break; }
    for (let i = 0; i < n; i++) {
      const c = buf[i];
      if (land[c] === 1 || trail[c] === 1) continue;
      if (simGenArr[c] !== simGen) { simGenArr[c] = simGen; simLay[c] = k; lay.push(c); }
    }
    x = nx; y = ny;
    // лоб в лоб: вне своей земли нельзя подпускать голову соперника ближе 20 единиц
    if (k <= CFG.headK && k > E.edelay - 1 && land[cellOf(x, y)] !== 1) {
      const dx = x - E.ex;
      const dy = y - E.ey;
      const reach = STEP * (k - E.edelay + 1) + 45;
      if (dx * dx + dy * dy < reach * reach) {
        let best = Infinity;
        for (let j = 0; j < 8; j++) {
          const a = j * (Math.PI / 4);
          const t = E.edelay + dubTicks(E.ex, E.ey, E.eh, x + Math.cos(a) * 17, y + Math.sin(a) * 17) - 0.5;
          if (t < best) best = t;
        }
        const sl = best - k;
        if (sl < r.hslack) r.hslack = sl;
      }
    }
    r.k = k;
    if ((lay.length > 0 || hasOld) && land[cellOf(x, y)] === 1) { r.closed = true; break; }
  }
  r.ex = x; r.ey = y; r.eh = h;
  return r;
}

// ---- захват: копия enclosure() движка с ограничением по прямоугольнику
function enclosure(lay) {
  const land = E.land;
  const trail = E.trail;
  let x0 = E.bx0, x1 = E.bx1, y0 = E.by0, y1 = E.by1;
  for (let i = 0; i < lay.length; i++) {
    const c = lay[i];
    const x = c % COLS;
    const y = (c / COLS) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1);
  x1 = Math.min(COLS - 1, x1 + 1); y1 = Math.min(ROWS - 1, y1 + 1);
  seenGen++;
  let sp = 0;
  const mine = (i) => land[i] === 1 || trail[i] === 1 || simGenArr[i] === simGen;
  const push = (i) => {
    if (seenArr[i] !== seenGen && !mine(i)) {
      seenArr[i] = seenGen;
      stack[sp++] = i;
    }
  };
  for (let x = x0; x <= x1; x++) { push(y0 * COLS + x); push(y1 * COLS + x); }
  for (let y = y0; y <= y1; y++) { push(y * COLS + x0); push(y * COLS + x1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % COLS;
    const y = (i / COLS) | 0;
    if (x > x0) push(i - 1);
    if (x < x1) push(i + 1);
    if (y > y0) push(i - COLS);
    if (y < y1) push(i + COLS);
  }
  let gain = 0;
  let stolen = 0;
  const enB = E.enBase;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * COLS + x;
      if (seenArr[i] === seenGen || land[i] === 1 || enB[i]) continue;
      gain++;
      if (land[i] === 2) stolen++;
    }
  }
  return { gain, stolen };
}

// ---- оценка кандидата
function evaluate(wps, tag, hz) {
  const horizon = Math.min(hz || 300, E.left - 1);
  const r = simulate(wps, horizon);
  const out = { wps, tag, key: -1e9, value: 0, T: r.k, slack: Infinity, kill: false, r, first: r.first, wi1: r.wi1 };
  if (r.bad) { out.key = -1e8; return out; }
  if (r.dead) { out.key = -1e7 + r.k; return out; }
  const hasTrail = r.lay.length > 0 || E.myTrailCells.length > 0;
  if (!r.closed) {
    if (hasTrail) { out.key = -1e6; return out; }
    // бродим по своей земле: безопасно, но бесполезно
    out.key = 0;
    out.value = 0;
    return out;
  }
  const en = E.en;
  const T = r.k;
  const g = enclosure(r.lay);
  let value = g.gain + g.stolen * CFG.stealW;
  // убийство
  let kill = false;
  if (r.killT > 0 && en.alive && E.teh > 0) {
    // клетка не должна быть в самой голове соперника
    const tr = en.trail;
    let idx = -1;
    const kx = cx_(r.killCell), ky = cy_(r.killCell);
    for (let i = tr.length - 1; i >= 0; i--) {
      if (Math.abs(tr[i].x - kx) <= 10 && Math.abs(tr[i].y - ky) <= 10) { idx = i; break; }
    }
    const fromHead = idx < 0 ? 99 : tr.length - 1 - idx;
    if (r.killT + E.killMargin <= E.teh && fromHead >= 3) kill = true;
  }
  if (kill) {
    const burn = Math.max(0, en.cells - 113);
    value += burn + CFG.killBonus;
  }
  // безопасность
  let slack = Infinity;
  const lay = r.lay;
  const oldc = E.myTrailCells;
  if (!kill) {
    for (let i = 0; i < lay.length; i++) { const s = Te(lay[i]) - T; if (s < slack) slack = s; }
    for (let i = 0; i < oldc.length; i++) { const s = Te(oldc[i]) - T; if (s < slack) slack = s; }
  } else {
    const kt = r.killT;
    for (let c of lay.concat(oldc)) {
      const te = Te(c);
      let s;
      if (te > kt + E.margin) {
        // соперник до убийства не успеет; после — возродится на базе
        s = kt + 60 + dubTicks(en.base.x, en.base.y, E.side === 0 ? 180 : 0, cx_(c), cy_(c)) - T;
        s = Math.min(s, te - kt);
      } else s = te - kt;
      if (s < slack) slack = s;
    }
  }
  if (r.hslack !== Infinity) slack = Math.min(slack, r.hslack + CFG.headOffset);
  out.value = value;
  out.kill = kill;
  out.slack = slack;
  out.gain = g.gain;
  out.stolen = g.stolen;
  const rate = value / (T + CFG.over);
  out.key = slack >= E.margin ? rate * (slack >= CFG.margin ? 1 : 0.7) : -1000 + Math.min(slack, 60);
  return out;
}

// ---- генераторы кандидатов
function u(deg) { return { x: Math.cos(deg * RAD), y: Math.sin(deg * RAD) }; }
const inField = (p, m = 40) => ({ x: clamp(p.x, m, WIDTH - m), y: clamp(p.y, m, HEIGHT - m) });

function genFresh() {
  const me = E.me;
  const phi = rr(0, 360);
  const d = u(phi);
  // сколько ехать до края своей земли
  let dOut = 0;
  while (dOut < 1500) {
    const px = me.x + d.x * dOut;
    const py = me.y + d.y * dOut;
    if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) break;
    if (E.land[cellOf(px, py)] !== 1) break;
    dOut += 10;
  }
  const a = dOut + rr(40, 360);
  const b = rr(70, 640);
  const sg = rnd() < 0.5 ? -1 : 1;
  const w1 = inField({ x: me.x + d.x * a, y: me.y + d.y * a });
  const v = u(phi + sg * 90);
  const w2 = inField({ x: w1.x + v.x * b, y: w1.y + v.y * b });
  const back = a * rr(0.6, 1.1);
  const w3 = inField({ x: w2.x - d.x * back, y: w2.y - d.y * back });
  const wps = [w1, w2];
  if (rnd() < 0.8) wps.push(w3);
  return wps;
}

function mutate(wps) {
  const w = wps.map((p) => ({ x: p.x, y: p.y }));
  const op = Math.floor(rr(0, 6));
  if (!w.length) return genFresh();
  if (op === 0) {
    const s = rr(15, 70);
    for (const p of w) { p.x += rr(-s, s); p.y += rr(-s, s); }
  } else if (op === 1) {
    const i = Math.floor(rr(0, w.length));
    const s = rr(20, 110);
    w[i].x += rr(-s, s); w[i].y += rr(-s, s);
  } else if (op === 2) {
    const dx = rr(-60, 60), dy = rr(-60, 60);
    for (const p of w) { p.x += dx; p.y += dy; }
  } else if (op === 3) {
    const m = E.me;
    const k = rr(0.85, 1.25);
    for (const p of w) { p.x = m.x + (p.x - m.x) * k; p.y = m.y + (p.y - m.y) * k; }
  } else if (op === 4 && w.length >= 2) {
    const i = Math.floor(rr(0, w.length - 1));
    w.splice(i + 1, 0, { x: (w[i].x + w[i + 1].x) / 2 + rr(-50, 50), y: (w[i].y + w[i + 1].y) / 2 + rr(-50, 50) });
  } else if (op === 5 && w.length >= 3) {
    w.splice(Math.floor(rr(0, w.length)), 1);
  } else {
    const i = Math.floor(rr(0, w.length));
    w[i].x += rr(-40, 40); w[i].y += rr(-40, 40);
  }
  return w.map((p) => inField(p, 30));
}

// Безопасное «топтание» на своей земле: глубокие клетки внутри территории и центр базы.
function genHover() {
  const out = [];
  if (E.core >= 0) out.push([{ x: cx_(E.core), y: cy_(E.core) }]);
  const d = E.deep;
  for (let i = 0; i < 4 && d.length; i++) {
    const c = d[Math.floor(rnd() * d.length)];
    out.push([{ x: cx_(c), y: cy_(c) }]);
  }
  out.push([{ x: E.me.base.x, y: E.me.base.y }]);
  return out;
}

function genReturns() {
  const me = E.me;
  const out = [[]];
  const t = me.trail;
  if (t.length) {
    const c0 = E.nearest[cellOf(t[0].x, t[0].y)];
    if (c0 >= 0) out.push([{ x: cx_(c0), y: cy_(c0) }]);
    const mid = t[Math.floor(t.length / 2)];
    const c1 = E.nearest[cellOf(mid.x, mid.y)];
    if (c1 >= 0) out.push([{ x: cx_(c1), y: cy_(c1) }]);
  }
  const cb = E.nearest[cellOf(me.base.x, me.base.y)];
  if (cb >= 0) out.push([{ x: cx_(cb), y: cy_(cb) }]);
  return out;
}

function genAttacks(maxN) {
  const en = E.en;
  const me = E.me;
  const out = [];
  if (!en.alive || !(E.teh > 0)) return out;
  const tr = en.trail;
  if (tr.length < 6) return out;
  const list = [];
  for (let i = 0; i < tr.length - 3; i += 2) {
    const p = tr[i];
    const t = dubTicks(me.x, me.y, me.heading, p.x, p.y);
    if (t + E.killMargin <= E.teh) list.push({ p, t });
  }
  list.sort((a, b) => a.t - b.t);
  for (let i = 0; i < Math.min(maxN, list.length); i++) out.push([{ x: list[i].p.x, y: list[i].p.y }]);
  return out;
}

// ---- состояние бота
let plan = null; // { wps }
let inited = false;

function think(budgetFresh, budgetMut, budgetAtk, deadline) {
  const cands = [];
  let inc = null;
  if (plan && plan.wps) {
    inc = evaluate(plan.wps, 'inc');
    cands.push(inc);
  }
  const outside = E.myTrailCells.length > 0;
  for (const w of genReturns()) cands.push(evaluate(w, 'ret'));
  for (const w of genAttacks(budgetAtk)) cands.push(evaluate(w, 'atk'));
  if (!outside) for (const w of genHover()) cands.push(evaluate(w, 'hov', CFG.hoverT));
  for (let i = 0; i < budgetFresh && nowMs() < deadline; i++) cands.push(evaluate(genFresh(), 'fresh'));
  // мутации лучших
  const seeds = cands.filter((c) => c.wps.length && c.key > -1e5).sort((a, b) => b.key - a.key).slice(0, 3);
  if (inc && inc.wps.length && !seeds.includes(inc)) seeds.push(inc);
  for (let i = 0; i < budgetMut && seeds.length && nowMs() < deadline; i++) {
    const sd = seeds[i % seeds.length];
    cands.push(evaluate(mutate(sd.wps), 'mut'));
  }
  const best = finalize(cands, inc);
  return best;
}

// Итоговый выбор: считаем, сколько ещё успеем набрать после петли по лучшей скорости этого хода.
function finalize(cands, inc) {
  let rbest = 0;
  for (const c of cands) if (c.key > 0 && c.slack >= E.margin && c.T > 0 && c.value >= CFG.minValue) rbest = Math.max(rbest, c.key);
  let best = null;
  for (const c of cands) {
    let k = c.key;
    if (k > -1e5 && c.slack >= E.margin && c.r.closed) {
      const rest = Math.max(0, E.left - c.T - CFG.over - CFG.tail);
      k = c.value + rbest * rest * CFG.restW;
      if (E.myTrailCells.length === 0 && c.value < CFG.minValue) k -= CFG.pointless;
      if (c === inc) k += Math.max(0, c.value) * (CFG.hyst - 1);
    } else if (!c.r.closed && !c.r.dead && !c.r.bad && k === 0) {
      // топтание на месте: потом начнём нормальную петлю
      const rest = Math.max(0, E.left - CFG.wait - CFG.over - CFG.tail);
      k = rbest * rest * CFG.restW;
      if (c === inc) k += rbest * CFG.hyst;
    } else if (c === inc && k > 0) k *= CFG.hyst;
    c.final = k;
    if (!best || k > best.final) best = c;
  }
  return best;
}

export default {
  init(info) {
    rnd = mulberry32(777 + SEED * 1009 + info.round * 31 + info.side);
    E.side = info.side;
    buildBaseMask(E.enBase, info.view.enemy.base);
    buildBaseMask(E.myBase, info.view.me.base);
    E.baseCells = E.myBase.reduce((a, b) => a + b, 0);
    plan = null;
    inited = true;
  },
  tick(s) {
    try {
      return tickInner(s);
    } catch (err) {
      plan = null;
      try {
        const c = E.nearest[cellOf(s.me.x, s.me.y)];
        if (c >= 0 && !s.me.home) return { heading: (Math.atan2(cy_(c) - s.me.y, cx_(c) - s.me.x) / RAD) };
      } catch (e2) {}
      return { turn: 0 };
    }
  },
};

function tickInner(s) {
  {
    if (!inited) {
      rnd = mulberry32(777 + SEED * 1009 + s.side);
      E.side = s.side;
      buildBaseMask(E.enBase, s.enemy.base);
      buildBaseMask(E.myBase, s.me.base);
      E.baseCells = E.myBase.reduce((a, b) => a + b, 0);
      inited = true;
    }
    if (!s.me.alive) {
      plan = null;
      return { turn: 0 };
    }
    buildEnv(s);
    const early = s.tick < 40;
    const home = s.me.home && E.myTrailCells.length === 0;
    const t0 = nowMs();
    const sc = SCALE * CFG.scale;
    const best = think(
      Math.round((early ? 90 : home ? 22 : 10) * sc),
      Math.round((early ? 90 : home ? 22 : 14) * sc),
      6,
      t0 + (s.tick < 36 ? 140 : 20),
    );
    if (!best) return { turn: 0 };
    plan = { wps: best.wps.slice(best.wi1) };
    return { turn: clamp(best.first, -1, 1) };
  }
}
