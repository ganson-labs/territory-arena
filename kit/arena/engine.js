// Territory Arena engine. Pure, deterministic, no DOM and no Node APIs:
// the same file drives the CLI sandbox, the replay tool and the browser viewer.
//
// The world is continuous (x, y in units, heading in degrees). Territory and trails
// are kept on a fine hidden raster of 10x10-unit cells; the viewer draws them as
// smooth shapes.

export const WIDTH = 1600;
export const HEIGHT = 1000;
export const CELL = 10;
export const COLS = WIDTH / CELL; // 160
export const ROWS = HEIGHT / CELL; // 100
export const CELLS = COLS * ROWS;
export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const ROUND_SECONDS = 120;
export const ROUND_TICKS = ROUND_SECONDS * TICK_RATE;
export const SPEED = 200; // units per second
export const STEP = SPEED * DT; // 10 units per tick
export const TURN_RATE = 240; // degrees per second
export const TURN_PER_TICK = TURN_RATE * DT; // 12 degrees per tick
export const BASE_RADIUS = 60;
export const RESPAWN_TICKS = 3 * TICK_RATE;
export const HEAD_HIT = 20; // heads closer than this collide
const SELF_GRACE_TICKS = 4; // the freshest trail cells under the head never kill it

// Maps: where the bases are. The second base mirrors the first through the centre.
function buildMap(name, x, y, heading) {
  return {
    name,
    bases: [
      { x, y, heading },
      { x: WIDTH - x, y: HEIGHT - y, heading: (heading + 180) % 360 },
    ],
  };
}

export const MAPS = [
  buildMap('Диагональ', 240, 240, 0),
  buildMap('Фланги', 200, 500, 0),
  buildMap('Ближний бой', 560, 380, 0),
];

// Round i of a match: each map is played twice in a row, sides swap every round.
export function roundPlan(i) {
  return { mapIndex: Math.floor(i / 2) % MAPS.length, swap: i % 2 === 1 };
}

export const cellIndex = (x, y) => Math.floor(y / CELL) * COLS + Math.floor(x / CELL);
export const cellCenter = (i) => ({ x: ((i % COLS) + 0.5) * CELL, y: (Math.floor(i / COLS) + 0.5) * CELL });
export const insideWorld = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
const RAD = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export function angleDiff(target, from) {
  let d = (target - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
const normHeading = (h) => ((h % 360) + 360) % 360;

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
    baseOf: new Int8Array(CELLS).fill(-1),
    trail: new Int8Array(CELLS).fill(-1),
    trailTick: new Int32Array(CELLS),
    players: map.bases.map((b, side) => ({
      side,
      name: players[side]?.name || `Игрок ${side + 1}`,
      x: b.x,
      y: b.y,
      heading: b.heading,
      alive: true,
      respawnIn: 0,
      trail: [], // trail points {x, y}: where the head left its land, then one per tick
      trailCells: [],
      cells: 0,
      tally: emptyTally(),
    })),
    moves: [[], []], // applied turn per tick, integer -1000..1000
    over: false,
    winner: null,
  };
  for (let i = 0; i < CELLS; i++) {
    const c = cellCenter(i);
    for (const s of [0, 1]) {
      const b = map.bases[s];
      if ((c.x - b.x) ** 2 + (c.y - b.y) ** 2 <= BASE_RADIUS * BASE_RADIUS) round.baseOf[i] = s;
    }
  }
  for (const p of round.players) claimBase(round, p);
  countCells(round);
  return round;
}

function claimBase(round, p) {
  for (let i = 0; i < CELLS; i++) if (round.baseOf[i] === p.side) round.land[i] = p.side;
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

// Bot answer -> applied turn as an integer in -1000..1000 (fraction of the max turn per tick).
// Accepts { turn: -1..1 }, { heading: degrees } or a bare number (= target heading). Junk = 0 (straight).
export function sanitizeTurn(action, heading) {
  let a = action;
  if (typeof a === 'number') a = { heading: a };
  if (!a || typeof a !== 'object') return 0;
  let v = 0;
  if (typeof a.heading === 'number' && Number.isFinite(a.heading)) v = angleDiff(a.heading, heading) / TURN_PER_TICK;
  else if (typeof a.turn === 'number' && Number.isFinite(a.turn)) v = a.turn;
  return Math.round(clamp(v, -1, 1) * 1000);
}

function playerView(round, p) {
  return {
    x: p.x,
    y: p.y,
    heading: p.heading,
    speed: SPEED,
    turnRate: TURN_RATE,
    alive: p.alive,
    respawnIn: p.respawnIn,
    home: p.alive && round.land[cellIndex(p.x, p.y)] === p.side,
    trail: p.trail.map((q) => ({ x: q.x, y: q.y })),
    trailCells: p.trailCells.length,
    cells: p.cells,
    percent: percentOf(round, p.side),
    base: { x: round.map.bases[p.side].x, y: round.map.bases[p.side].y, radius: BASE_RADIUS },
    kills: p.tally.kills,
    deaths: p.tally.deaths,
  };
}

// What a bot sees on its turn. Always a fresh object: bots cannot touch engine state.
// land / trail: Int8Array(COLS*ROWS), index row*COLS + col: 0 empty, 1 yours, 2 the enemy's.
export function botView(round, side) {
  const land = new Int8Array(CELLS);
  const trail = new Int8Array(CELLS);
  const other = 1 - side;
  for (let i = 0; i < CELLS; i++) {
    const l = round.land[i];
    land[i] = l === side ? 1 : l === other ? 2 : 0;
    const t = round.trail[i];
    trail[i] = t === side ? 1 : t === other ? 2 : 0;
  }
  return {
    tick: round.tick,
    time: round.tick * DT,
    timeLeft: Math.max(0, ROUND_SECONDS - round.tick * DT),
    dt: DT,
    side,
    width: WIDTH,
    height: HEIGHT,
    cell: CELL,
    cols: COLS,
    rows: ROWS,
    mapName: round.map.name,
    land,
    trail,
    me: playerView(round, round.players[side]),
    enemy: playerView(round, round.players[other]),
  };
}

function kill(round, p, cause, by, events) {
  const lost = p.cells - countBase(round, p.side);
  const trailLen = p.trailCells.length;
  for (const i of p.trailCells) if (round.trail[i] === p.side) round.trail[i] = -1;
  p.trail = [];
  p.trailCells = [];
  for (let i = 0; i < CELLS; i++) if (round.land[i] === p.side && round.baseOf[i] !== p.side) round.land[i] = -1;
  p.alive = false;
  p.respawnIn = RESPAWN_TICKS;
  p.tally.deaths++;
  if (cause === 'self') p.tally.selfDeaths++;
  if (cause === 'wall') p.tally.wallDeaths++;
  if (by != null) round.players[by].tally.kills++;
  events.push({ type: 'death', side: p.side, x: p.x, y: p.y, cause, by, lostCells: lost, trailLength: trailLen });
}

function countBase(round, side) {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (round.baseOf[i] === side) n++;
  return n;
}

// What becomes the player's land when the trail closes: the trail itself and everything
// that cannot be reached from outside the field without crossing the player's land or trail.
function enclosure(round, side) {
  const p = round.players[side];
  const mine = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) if (round.land[i] === side) mine[i] = 1;
  for (const i of p.trailCells) mine[i] = 1;
  const seen = new Uint8Array(CELLS);
  const stack = [];
  const push = (i) => {
    if (!seen[i] && !mine[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < COLS; x++) {
    push(x);
    push((ROWS - 1) * COLS + x);
  }
  for (let y = 0; y < ROWS; y++) {
    push(y * COLS);
    push(y * COLS + COLS - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % COLS;
    if (x > 0) push(i - 1);
    if (x < COLS - 1) push(i + 1);
    if (i >= COLS) push(i - COLS);
    if (i < CELLS - COLS) push(i + COLS);
  }
  const gained = [];
  for (let i = 0; i < CELLS; i++) if (!seen[i] && round.land[i] !== side && round.baseOf[i] !== 1 - side) gained.push(i);
  return gained;
}

// Cells crossed by the segment (x0,y0)->(x1,y1), in order, without the start cell.
// A diagonal jump gets the in-between cell too, so a trail is always edge-connected
// and nothing can slip through it.
function sweep(x0, y0, x1, y1) {
  const out = [];
  let cx = Math.floor(x0 / CELL);
  let cy = Math.floor(y0 / CELL);
  const n = 4;
  for (let k = 1; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    const y = y0 + ((y1 - y0) * k) / n;
    const nx = Math.floor(x / CELL);
    const ny = Math.floor(y / CELL);
    if (nx === cx && ny === cy) continue;
    if (nx !== cx && ny !== cy) out.push({ x: nx, y: cy });
    out.push({ x: nx, y: ny });
    cx = nx;
    cy = ny;
  }
  return out.filter((c) => c.x >= 0 && c.y >= 0 && c.x < COLS && c.y < ROWS).map((c) => c.y * COLS + c.x);
}

// Closest approach of two points moving linearly during one tick.
function closest(a0, a1, b0, b1) {
  const rx = b0.x - a0.x;
  const ry = b0.y - a0.y;
  const vx = b1.x - b0.x - (a1.x - a0.x);
  const vy = b1.y - b0.y - (a1.y - a0.y);
  const vv = vx * vx + vy * vy;
  const t = vv > 1e-9 ? clamp(-(rx * vx + ry * vy) / vv, 0, 1) : 0;
  return { d: Math.hypot(rx + vx * t, ry + vy * t), t };
}

// Advance one tick. actions[side]: { turn } | { heading } | number (see sanitizeTurn).
export function stepRound(round, actions) {
  if (round.over) return [];
  const events = [];
  const P = round.players;

  // 1. Respawn. On its respawn tick a player stands still on its base.
  const fresh = [false, false];
  for (const p of P) {
    if (p.alive) continue;
    p.tally.ticksDead++;
    if (--p.respawnIn > 0) continue;
    const b = round.map.bases[p.side];
    p.alive = true;
    p.x = b.x;
    p.y = b.y;
    p.heading = b.heading;
    fresh[p.side] = true;
    claimBase(round, p);
    events.push({ type: 'respawn', side: p.side, x: p.x, y: p.y });
  }

  // 2. Turn and move.
  const moving = [];
  for (const p of P) {
    let q = 0;
    if (p.alive && !fresh[p.side]) {
      q = sanitizeTurn(actions?.[p.side], p.heading);
      p.heading = normHeading(p.heading + (q / 1000) * TURN_PER_TICK);
      const nx = p.x + Math.cos(p.heading * RAD) * STEP;
      const ny = p.y + Math.sin(p.heading * RAD) * STEP;
      moving.push({ p, from: { x: p.x, y: p.y }, to: { x: nx, y: ny }, cells: sweep(p.x, p.y, nx, ny) });
    }
    round.moves[p.side].push(q);
  }
  const dead = new Map(); // side -> { cause, by }
  for (const m of moving) if (!insideWorld(m.to.x, m.to.y)) dead.set(m.p.side, { cause: 'wall', by: null });

  // 3. Heads meet: whoever is on its own land survives; elsewhere both die.
  if (moving.length === 2) {
    const [a, b] = moving;
    const c = closest(a.from, a.to, b.from, b.to);
    if (c.d < HEAD_HIT) {
      for (const m of moving) {
        if (dead.has(m.p.side)) continue;
        const home = insideWorld(m.to.x, m.to.y) && round.land[cellIndex(m.to.x, m.to.y)] === m.p.side;
        if (!home) dead.set(m.p.side, { cause: 'head', by: 1 - m.p.side });
      }
      events.push({ type: 'headon', x: (a.to.x + b.to.x) / 2, y: (a.to.y + b.to.y) / 2 });
    }
  }

  // 4. Trails: crossing the enemy's trail kills its owner; crossing your own kills you.
  for (const m of moving) {
    const side = m.p.side;
    if (dead.has(side) && dead.get(side).cause !== 'cut') continue;
    for (const i of m.cells) {
      const t = round.trail[i];
      if (t === side && round.tick - round.trailTick[i] > SELF_GRACE_TICKS) {
        dead.set(side, { cause: 'self', by: null });
        break;
      }
      if (t === 1 - side && !dead.has(t)) {
        const c = cellCenter(i);
        dead.set(t, { cause: 'cut', by: side, x: c.x, y: c.y });
      }
    }
  }

  for (const m of moving) {
    if (dead.has(m.p.side) && dead.get(m.p.side).cause === 'wall') {
      m.p.x = clamp(m.to.x, 0, WIDTH - 0.001);
      m.p.y = clamp(m.to.y, 0, HEIGHT - 0.001);
    } else {
      m.p.x = m.to.x;
      m.p.y = m.to.y;
    }
  }
  for (const [side, d] of [...dead.entries()].sort((a, b) => a[0] - b[0])) {
    kill(round, P[side], d.cause, d.by, events);
    if (d.cause === 'cut') events[events.length - 1].cutAt = { x: d.x, y: d.y };
  }

  // 5. Lay trails, detect closing loops.
  const closing = [];
  for (const m of moving) {
    const p = m.p;
    if (!p.alive) continue;
    for (const i of m.cells) {
      if (round.land[i] === p.side) continue;
      if (!p.trailCells.length) p.trail.push({ x: m.from.x, y: m.from.y });
      if (round.trail[i] !== p.side) {
        round.trail[i] = p.side;
        round.trailTick[i] = round.tick;
        p.trailCells.push(i);
      }
    }
    const home = round.land[cellIndex(p.x, p.y)] === p.side;
    if (p.trailCells.length) {
      p.trail.push({ x: p.x, y: p.y });
      p.tally.maxTrail = Math.max(p.tally.maxTrail, p.trailCells.length);
      if (home) closing.push(p);
    }
  }

  // 6. Captures happen together: a cell claimed by both stays with its previous owner.
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
      sx += (i % COLS) + 0.5;
      sy += Math.floor(i / COLS) + 0.5;
      cells.push(i);
    }
    for (const i of p.trailCells) if (round.trail[i] === p.side) round.trail[i] = -1;
    const trailLength = p.trailCells.length;
    p.trail = [];
    p.trailCells = [];
    p.tally.captures++;
    p.tally.captured += taken;
    p.tally.biggestCapture = Math.max(p.tally.biggestCapture, taken);
    events.push({
      type: 'capture', side: p.side, cells, count: taken, stolen, trailLength,
      x: taken ? (sx / taken) * CELL : p.x, y: taken ? (sy / taken) * CELL : p.y,
    });
  }

  countCells(round);
  for (const p of P) if (p.alive && p.trailCells.length) p.tally.ticksOut++;

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
// A replay keeps the applied turns of both sides. The engine is deterministic,
// so they rebuild the round exactly.

export function replayRound(replay, onStep) {
  const round = createRound({ mapIndex: replay.mapIndex, players: replay.players });
  const moves = replay.moves || [[], []];
  while (!round.over) {
    const t = round.tick;
    const actions = [0, 1].map((s) => ({ turn: (moves[s][t] || 0) / 1000 }));
    const events = stepRound(round, actions);
    onStep?.(round, events);
  }
  return round;
}
