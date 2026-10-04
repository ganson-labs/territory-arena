// Shared helpers for the sparring bots: raster path search and steering.
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const deg = (r) => (r * 180) / Math.PI;
export const angleTo = (from, x, y) => deg(Math.atan2(y - from.y, x - from.x));
export function diff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// BFS over the raster from (x, y) to the first cell where goal(i) holds.
// Cells where blocked(i) holds are walls. Returns the path of cell indices (start excluded) or null.
export function path(s, x, y, goal, blocked) {
  const C = s.cols;
  const R = s.rows;
  const start = Math.floor(y / s.cell) * C + Math.floor(x / s.cell);
  if (start < 0 || start >= C * R) return null;
  const prev = new Int32Array(C * R).fill(-1);
  prev[start] = start;
  const queue = new Int32Array(C * R);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const cx = i % C;
    const cy = (i / C) | 0;
    for (const [dx, dy] of N4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= C || ny >= R) continue;
      const j = ny * C + nx;
      if (prev[j] !== -1 || blocked(j)) continue;
      prev[j] = i;
      if (goal(j)) {
        const out = [j];
        let k = i;
        while (k !== start) {
          out.push(k);
          k = prev[k];
        }
        return out.reverse();
      }
      queue[tail++] = j;
    }
  }
  return null;
}

export const center = (s, i) => ({ x: ((i % s.cols) + 0.5) * s.cell, y: (((i / s.cols) | 0) + 0.5) * s.cell });

// Shortest way home that does not cross my own trail (except the freshest cells under my head).
export function homePath(s) {
  const me = s.me;
  const near = new Set();
  const t = me.trail;
  for (let k = Math.max(0, t.length - 3); k < t.length; k++) near.add(Math.floor(t[k].y / s.cell) * s.cols + Math.floor(t[k].x / s.cell));
  return path(s, me.x, me.y, (j) => s.land[j] === 1, (j) => s.trail[j] === 1 && !near.has(j));
}

// Steer along a cell path: aim a few cells ahead.
export function follow(s, p, ahead = 4) {
  const c = center(s, p[Math.min(ahead, p.length - 1)]);
  return { heading: angleTo(s.me, c.x, c.y) };
}

// Keep away from the field edge: if the point ahead is outside, aim at the middle.
export function avoidWalls(s, wanted) {
  const me = s.me;
  const h = wanted?.heading ?? me.heading;
  const look = 125;
  const ax = me.x + Math.cos((h * Math.PI) / 180) * look;
  const ay = me.y + Math.sin((h * Math.PI) / 180) * look;
  if (ax > 25 && ay > 25 && ax < s.width - 25 && ay < s.height - 25) return wanted;
  return { heading: angleTo(me, s.width / 2, s.height / 2) };
}

// Distance from the enemy head to the closest point of my trail (or my head).
export function threat(s) {
  const e = s.enemy;
  if (!e.alive) return Infinity;
  let best = Math.hypot(e.x - s.me.x, e.y - s.me.y);
  for (const q of s.me.trail) best = Math.min(best, Math.hypot(e.x - q.x, e.y - q.y));
  return best;
}

// Heading with the most free (not mine) land ahead, among 8 directions.
export function freestHeading(s) {
  const me = s.me;
  let best = me.heading;
  let bestScore = -Infinity;
  for (let k = 0; k < 8; k++) {
    const h = k * 45;
    let score = 0;
    for (let d = 30; d <= 300; d += 15) {
      const x = me.x + Math.cos((h * Math.PI) / 180) * d;
      const y = me.y + Math.sin((h * Math.PI) / 180) * d;
      if (x < 20 || y < 20 || x > s.width - 20 || y > s.height - 20) {
        score -= 40;
        break;
      }
      const v = s.land[Math.floor(y / s.cell) * s.cols + Math.floor(x / s.cell)];
      score += v === 1 ? 0 : v === 2 ? 3 : 2;
    }
    score -= Math.abs(diff(h, me.heading)) / 60;
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

// Predict the next ticks for a few turn choices and keep the wanted course only if it is safe:
// no field edge and no own trail ahead. Otherwise take the turn that survives longest.
export function safeSteer(s, want) {
  const me = s.me;
  const fresh = new Set();
  const t = me.trail;
  for (let k = Math.max(0, t.length - 4); k < t.length; k++) fresh.add(Math.floor(t[k].y / s.cell) * s.cols + Math.floor(t[k].x / s.cell));
  const wantHeading = want?.heading ?? me.heading + (want?.turn ?? 0) * me.turnRate * s.dt;
  const per = me.turnRate * s.dt;
  const step = me.speed * s.dt;
  const sim = (mode) => {
    let x = me.x;
    let y = me.y;
    let h = me.heading;
    for (let k = 1; k <= 14; k++) {
      const turn = mode === 'want' ? Math.max(-1, Math.min(1, diff(wantHeading, h) / per)) : mode;
      h += turn * per;
      x += Math.cos((h * Math.PI) / 180) * step;
      y += Math.sin((h * Math.PI) / 180) * step;
      if (x < 6 || y < 6 || x > s.width - 6 || y > s.height - 6) return k;
      const c = Math.floor(y / s.cell) * s.cols + Math.floor(x / s.cell);
      if (s.trail[c] === 1 && !fresh.has(c)) return k;
    }
    return 99;
  };
  if (sim('want') === 99) return { heading: wantHeading };
  let best = 0;
  let bestK = -1;
  for (const turn of [0, -0.5, 0.5, -1, 1]) {
    const k = sim(turn);
    if (k > bestK) {
      bestK = k;
      best = turn;
    }
  }
  return { turn: best };
}

const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A rectangular loop out of my land as waypoints: out, sideways, then home by path.
export function makeLoop(s, size, side) {
  const me = s.me;
  const out = freestHeading(s);
  const r = (out * Math.PI) / 180;
  const sr = ((out + side * 90) * Math.PI) / 180;
  const m = 70;
  const p1 = { x: clampTo(me.x + Math.cos(r) * size, m, s.width - m), y: clampTo(me.y + Math.sin(r) * size, m, s.height - m) };
  const p2 = { x: clampTo(p1.x + Math.cos(sr) * size * 0.8, m, s.width - m), y: clampTo(p1.y + Math.sin(sr) * size * 0.8, m, s.height - m) };
  return [p1, p2];
}

// Shared brain: farm loops, run home when threatened. Returns an action.
export function farm(s, st, size, threatMargin) {
  const me = s.me;
  if (me.home && me.trailCells === 0) {
    if (!st.points.length) {
      st.points = makeLoop(s, size(st.loops), st.loops % 2 ? 1 : -1);
      st.loops++;
    }
  }
  const home = me.trailCells ? homePath(s) : null;
  if (home && threat(s) < home.length * s.cell + threatMargin) st.points = [];
  while (st.points.length && Math.hypot(st.points[0].x - me.x, st.points[0].y - me.y) < 30) st.points.shift();
  if (st.points.length) return safeSteer(s, { heading: angleTo(me, st.points[0].x, st.points[0].y) });
  if (home) return safeSteer(s, follow(s, home, 5));
  return safeSteer(s, { turn: 0 });
}
