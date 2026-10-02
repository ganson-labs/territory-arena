// Общие помощники спарринг-ботов: поиск пути по сетке.
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
export const PERP = { up: ['left', 'right'], down: ['right', 'left'], left: ['down', 'up'], right: ['up', 'down'] };

export function safeStep(s, x, y, dir, d) {
  if (d === OPP[dir]) return false;
  const nx = x + DIRS[d][0];
  const ny = y + DIRS[d][1];
  if (nx < 0 || ny < 0 || nx >= s.width || ny >= s.height) return false;
  return s.trail[ny * s.width + nx] !== 1;
}

// BFS от (x, y) до первой клетки, где goal(i) истинно. Свой хвост — препятствие.
// Возвращает { dir: первый шаг, dist } или null.
export function bfs(s, x, y, dir, goal, blockedTrail = 1) {
  const W = s.width;
  const H = s.height;
  const prev = new Int32Array(W * H).fill(-1);
  const first = new Array(W * H);
  const start = y * W + x;
  prev[start] = start;
  let frontier = [start];
  let dist = 0;
  while (frontier.length) {
    dist++;
    const next = [];
    for (const i of frontier) {
      const cx = i % W;
      const cy = (i / W) | 0;
      for (const d of ['up', 'down', 'left', 'right']) {
        if (i === start && dir && d === OPP[dir]) continue;
        const nx = cx + DIRS[d][0];
        const ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (prev[j] !== -1 || s.trail[j] === blockedTrail) continue;
        prev[j] = i;
        first[j] = i === start ? d : first[i];
        if (goal(j)) return { dir: first[j], dist, x: nx, y: ny };
        next.push(j);
      }
    }
    frontier = next;
  }
  return null;
}

export const homePath = (s) => bfs(s, s.me.x, s.me.y, s.me.dir, (j) => s.land[j] === 1);

export function anySafe(s) {
  const { x, y, dir } = s.me;
  const order = [dir, ...PERP[dir]];
  let best = null;
  let bestFree = -1;
  for (const d of order) {
    if (!safeStep(s, x, y, dir, d)) continue;
    const nx = x + DIRS[d][0];
    const ny = y + DIRS[d][1];
    const free = Math.min(nx, ny, s.width - 1 - nx, s.height - 1 - ny);
    if (free > bestFree) {
      best = d;
      bestFree = free;
    }
  }
  return best || dir;
}

// Расстояние от головы соперника до ближайшей клетки моего хвоста (или моей головы).
export function enemyThreat(s) {
  const e = s.enemy;
  if (!e.alive) return Infinity;
  let best = Math.abs(e.x - s.me.x) + Math.abs(e.y - s.me.y);
  for (const c of s.me.trail) best = Math.min(best, Math.abs(e.x - c.x) + Math.abs(e.y - c.y));
  return best;
}

// Направление «наружу»: где больше нейтральной земли в полосе шириной band.
export function freestDir(s, x, y, dir, band = 6) {
  let best = null;
  let bestScore = -Infinity;
  for (const d of ['up', 'down', 'left', 'right']) {
    if (d === OPP[dir]) continue;
    let score = 0;
    for (let k = 1; k <= band * 2; k++) {
      const nx = x + DIRS[d][0] * k;
      const ny = y + DIRS[d][1] * k;
      if (nx < 0 || ny < 0 || nx >= s.width || ny >= s.height) {
        score -= 3 * (band * 2 - k + 1);
        break;
      }
      const v = s.land[ny * s.width + nx];
      score += v === 0 ? 2 : v === 2 ? 3 : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best || dir;
}
