// Territory Arena engine. Pure, deterministic, no DOM and no Node APIs:
// the same file drives the CLI sandbox, the replay tool and the browser viewer.

export const W = 64;
export const H = 40;
export const CELLS = W * H;
export const TICK_RATE = 10; // ходов в секунду
export const DT = 1 / TICK_RATE;
export const ROUND_SECONDS = 120;
export const ROUND_TICKS = ROUND_SECONDS * TICK_RATE;
export const RESPAWN_TICKS = 3 * TICK_RATE;
export const BASE_RADIUS = 1; // база 3x3 вокруг центра

export const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
export const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const DIR_CODE = { up: 'U', down: 'D', left: 'L', right: 'R' };
const CODE_DIR = { U: 'up', D: 'down', L: 'left', R: 'right' };

// Карты: где стоят базы. Вторая база — отражение первой относительно центра,
// поэтому стороны равны. Препятствий нет: поле открыто, край поля — стена.
function buildMap(name, cx, cy, dir) {
  return {
    name,
    bases: [
      { x: cx, y: cy, dir },
      { x: W - 1 - cx, y: H - 1 - cy, dir: OPPOSITE[dir] },
    ],
  };
}

export const MAPS = [
  buildMap('Диагональ', 7, 7, 'right'),
  buildMap('Фланги', 6, 19, 'right'),
  buildMap('Ближний бой', 22, 14, 'right'),
];

// Раунд i матча: каждая карта играется дважды подряд, стороны меняются каждый раунд.
// Раунды 1-2 — Диагональ, 3-4 — Фланги, 5-6 — Ближний бой, дальше по кругу.
export function roundPlan(i) {
  return { mapIndex: Math.floor(i / 2) % MAPS.length, swap: i % 2 === 1 };
}

export const idx = (x, y) => y * W + x;
export const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

// ---------- round ----------

function emptyTally() {
  return { captures: 0, captured: 0, biggestCapture: 0, kills: 0, deaths: 0, selfDeaths: 0, wallDeaths: 0, maxTrail: 0, ticksDead: 0, ticksOut: 0 };
}

export function createRound({ mapIndex = 0, players = [{}, {}] } = {}) {
  const map = MAPS[mapIndex % MAPS.length];
  const round = {
    tick: 0,
    mapIndex: mapIndex % MAPS.length,
    map,
    land: new Int8Array(CELLS).fill(-1),
    baseOf: new Int8Array(CELLS).fill(-1), // база неприкосновенна: её нельзя захватить
    trail: new Int8Array(CELLS).fill(-1),
    players: map.bases.map((b, side) => ({
      side,
      name: players[side]?.name || `Игрок ${side + 1}`,
      x: b.x,
      y: b.y,
      dir: b.dir,
      alive: true,
      respawnIn: 0,
      trail: [],
      cells: 0,
      tally: emptyTally(),
    })),
    moves: ['', ''], // применённые ходы по тикам: U D L R, S — стоял (мёртв)
    over: false,
    winner: null,
  };
  for (const p of round.players) claimBase(round, p);
  for (let i = 0; i < CELLS; i++) if (round.land[i] >= 0) round.baseOf[i] = round.land[i];
  countCells(round);
  return round;
}

function claimBase(round, p) {
  const b = round.map.bases[p.side];
  for (let dy = -BASE_RADIUS; dy <= BASE_RADIUS; dy++) {
    for (let dx = -BASE_RADIUS; dx <= BASE_RADIUS; dx++) round.land[idx(b.x + dx, b.y + dy)] = p.side;
  }
}

function countCells(round) {
  const c = [0, 0];
  for (let i = 0; i < CELLS; i++) if (round.land[i] >= 0) c[round.land[i]]++;
  round.players[0].cells = c[0];
  round.players[1].cells = c[1];
}

export function percentOf(round, side) {
  return (100 * round.players[side].cells) / CELLS;
}

// Любой мусор от бота превращается в направление; разворот на 180° запрещён (считается «прямо»).
export function sanitizeAction(action, currentDir) {
  let a = action;
  if (a && typeof a === 'object') a = a.dir ?? a.direction;
  if (typeof a === 'string') a = a.trim().toLowerCase();
  if (a === 'u') a = 'up';
  else if (a === 'd') a = 'down';
  else if (a === 'l') a = 'left';
  else if (a === 'r') a = 'right';
  if (!DIRS[a] || a === OPPOSITE[currentDir]) return currentDir;
  return a;
}

export const dirCode = (d) => DIR_CODE[d] || 'S';
export const codeDir = (c) => CODE_DIR[c] || 'straight';

function playerView(round, p) {
  return {
    x: p.x,
    y: p.y,
    dir: p.dir,
    alive: p.alive,
    respawnIn: p.respawnIn,
    trail: p.trail.map((i) => ({ x: i % W, y: (i / W) | 0 })),
    trailLength: p.trail.length,
    cells: p.cells,
    percent: percentOf(round, p.side),
    home: round.land[idx(p.x, p.y)] === p.side,
    base: { x: round.map.bases[p.side].x, y: round.map.bases[p.side].y },
    kills: p.tally.kills,
    deaths: p.tally.deaths,
  };
}

// Что видит бот. Всегда свежий объект: бот не может испортить состояние движка.
// land / trail — плоские массивы W*H, индекс y*width + x: 0 — пусто, 1 — твоё, 2 — соперника.
export function botView(round, side) {
  const rel = (v) => (v < 0 ? 0 : v === side ? 1 : 2);
  const land = new Array(CELLS);
  const trail = new Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    land[i] = rel(round.land[i]);
    trail[i] = rel(round.trail[i]);
  }
  return {
    tick: round.tick,
    time: round.tick * DT,
    timeLeft: Math.max(0, ROUND_SECONDS - round.tick * DT),
    ticksLeft: Math.max(0, ROUND_TICKS - round.tick),
    tickRate: TICK_RATE,
    side,
    width: W,
    height: H,
    mapName: round.map.name,
    land,
    trail,
    me: playerView(round, round.players[side]),
    enemy: playerView(round, round.players[1 - side]),
  };
}

function kill(round, p, cause, by, events) {
  const lost = p.cells;
  const trailLen = p.trail.length;
  for (const i of p.trail) if (round.trail[i] === p.side) round.trail[i] = -1;
  p.trail = [];
  for (let i = 0; i < CELLS; i++) if (round.land[i] === p.side && round.baseOf[i] !== p.side) round.land[i] = -1;
  p.alive = false;
  p.respawnIn = RESPAWN_TICKS;
  p.tally.deaths++;
  if (cause === 'self') p.tally.selfDeaths++;
  if (cause === 'wall') p.tally.wallDeaths++;
  if (by != null) round.players[by].tally.kills++;
  events.push({ type: 'death', side: p.side, x: p.x, y: p.y, cause, by, lostCells: lost, trailLength: trailLen });
}

// Что станет землёй игрока, если его хвост замкнётся: сам хвост и всё, что не достижимо снаружи поля.
function enclosure(round, side) {
  const p = round.players[side];
  const mine = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) if (round.land[i] === side) mine[i] = 1;
  for (const i of p.trail) mine[i] = 1;
  const seen = new Uint8Array(CELLS);
  const stack = [];
  const push = (i) => {
    if (!seen[i] && !mine[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    push(idx(x, 0));
    push(idx(x, H - 1));
  }
  for (let y = 0; y < H; y++) {
    push(idx(0, y));
    push(idx(W - 1, y));
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  const gained = [];
  for (let i = 0; i < CELLS; i++) if (!seen[i] && round.land[i] !== side && round.baseOf[i] !== 1 - side) gained.push(i);
  return gained;
}

// Один ход. actions[side] — 'up' | 'down' | 'left' | 'right' | 'straight' (или что угодно: мусор = прямо).
export function stepRound(round, actions) {
  if (round.over) return [];
  const events = [];
  const P = round.players;

  // 1. Возрождение. В ход возрождения игрок стоит на базе.
  for (const p of P) p.respawnedThisTick = false;
  for (const p of P) {
    if (p.alive) continue;
    p.tally.ticksDead++;
    if (--p.respawnIn > 0) continue;
    const b = round.map.bases[p.side];
    p.alive = true;
    p.x = b.x;
    p.y = b.y;
    p.dir = b.dir;
    p.respawnedThisTick = true;
    claimBase(round, p);
    events.push({ type: 'respawn', side: p.side, x: p.x, y: p.y });
  }

  // 2. Новые клетки. Выход за край поля — гибель.
  const moving = [];
  for (const p of P) {
    if (!p.alive || p.respawnedThisTick) continue;
    p.dir = sanitizeAction(actions?.[p.side], p.dir);
    const d = DIRS[p.dir];
    const nx = p.x + d.dx;
    const ny = p.y + d.dy;
    moving.push({ p, nx, ny, from: idx(p.x, p.y) });
  }
  for (const p of P) round.moves[p.side] += moving.some((m) => m.p === p) ? dirCode(p.dir) : 'S';
  const dead = new Map(); // side -> { cause, by }
  for (const m of moving) {
    if (!inside(m.nx, m.ny)) dead.set(m.p.side, { cause: 'wall', by: null });
  }
  const live = moving.filter((m) => !dead.has(m.p.side));

  // 3. Столкновение голов (одна клетка или обмен клетками): выживает тот, кто въезжает на свою землю.
  if (live.length === 2) {
    const [a, b] = live;
    const ia = idx(a.nx, a.ny);
    const ib = idx(b.nx, b.ny);
    const same = ia === ib;
    const swap = ia === b.from && ib === a.from;
    if (same || swap) {
      for (const m of live) {
        const i = idx(m.nx, m.ny);
        if (round.land[i] !== m.p.side) dead.set(m.p.side, { cause: 'head', by: 1 - m.p.side });
      }
      events.push({ type: 'headon', x: b.nx, y: b.ny });
    }
  }

  // 4. Хвосты: наехал на чужой — хозяин хвоста погибает, на свой — погибаешь сам.
  for (const m of live) {
    if (dead.has(m.p.side) && dead.get(m.p.side).cause === 'head') continue;
    const t = round.trail[idx(m.nx, m.ny)];
    if (t === m.p.side) dead.set(m.p.side, { cause: 'self', by: null });
    else if (t >= 0 && !dead.has(t)) {
      dead.set(t, { cause: 'cut', by: m.p.side, x: m.nx, y: m.ny });
    }
  }

  // Двигаем всех, кто ещё жив в этом ходе, затем применяем гибели.
  for (const m of moving) {
    if (dead.has(m.p.side) && dead.get(m.p.side).cause === 'wall') continue;
    m.p.x = m.nx;
    m.p.y = m.ny;
  }
  for (const [side, d] of [...dead.entries()].sort((a, b) => a[0] - b[0])) {
    kill(round, P[side], d.cause, d.by, events);
    if (d.cause === 'cut') events[events.length - 1].cutAt = { x: d.x, y: d.y };
  }

  // 5. Хвост и захват.
  const closing = [];
  for (const m of moving) {
    const p = m.p;
    if (!p.alive) continue;
    const i = idx(p.x, p.y);
    if (round.land[i] === p.side) {
      if (p.trail.length) closing.push(p);
    } else {
      round.trail[i] = p.side;
      p.trail.push(i);
      p.tally.maxTrail = Math.max(p.tally.maxTrail, p.trail.length);
    }
  }
  // Захваты одновременные: клетка, на которую претендуют оба, остаётся прежнему хозяину.
  const gains = closing.map((p) => ({ p, cells: enclosure(round, p.side) }));
  const claim = new Int8Array(CELLS).fill(-1);
  for (const g of gains) for (const i of g.cells) claim[i] = claim[i] === -1 ? g.p.side : 9;
  for (const g of gains) {
    const p = g.p;
    let taken = 0;
    let stolen = 0;
    let sx = 0;
    let sy = 0;
    const cells = [];
    for (const i of g.cells) {
      if (claim[i] !== p.side) continue;
      if (round.land[i] === 1 - p.side) stolen++;
      round.land[i] = p.side;
      taken++;
      sx += i % W;
      sy += (i / W) | 0;
      cells.push(i);
    }
    for (const i of p.trail) if (round.trail[i] === p.side) round.trail[i] = -1;
    const trailLength = p.trail.length;
    p.trail = [];
    p.tally.captures++;
    p.tally.captured += taken;
    p.tally.biggestCapture = Math.max(p.tally.biggestCapture, taken);
    events.push({
      type: 'capture', side: p.side, cells, count: taken, stolen, trailLength,
      x: taken ? sx / taken : p.x, y: taken ? sy / taken : p.y,
    });
  }

  countCells(round);
  // Потерял всю землю (её целиком обвели) — гибель.
  for (const p of P) {
    if (p.alive && p.cells === 0) kill(round, p, 'land', 1 - p.side, events);
  }
  if (events.some((e) => e.type === 'death')) countCells(round);
  for (const p of P) if (p.alive && p.trail.length) p.tally.ticksOut++;

  round.tick++;
  if (round.tick >= ROUND_TICKS) {
    round.over = true;
    const [a, b] = P;
    round.winner = a.cells === b.cells ? null : a.cells > b.cells ? 0 : 1;
    events.push({ type: 'roundOver', winner: round.winner });
  }
  return events;
}

// ---------- replay ----------
// Реплей хранит применённые ходы обеих сторон: движок детерминирован,
// поэтому по ним раунд восстанавливается клетка в клетку.

export function replayRound(replay, onStep) {
  const round = createRound({ mapIndex: replay.mapIndex, players: replay.players });
  const moves = replay.moves || ['', ''];
  while (!round.over) {
    const t = round.tick;
    const actions = [0, 1].map((s) => codeDir(moves[s][t]));
    const events = stepRound(round, actions);
    onStep?.(round, events);
  }
  return round;
}
