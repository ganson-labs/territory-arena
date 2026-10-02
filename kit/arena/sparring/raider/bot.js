// Спарринг «Охотник»: короткие вылазки, а когда хвост соперника ближе, чем соперник к дому, — режет его.
import { DIRS, PERP, safeStep, bfs, homePath, anySafe, enemyThreat, freestDir } from '../common.js';

let plan = [];
let loops = 0;

function enemyHomeDist(s) {
  const e = s.enemy;
  const r = bfs(s, e.x, e.y, e.dir, (j) => s.land[j] === 2, 2);
  return r ? r.dist : 99;
}

export default {
  init() {
    plan = [];
    loops = 0;
  },
  tick(s) {
    const me = s.me;
    if (!me.alive) {
      plan = [];
      return 'straight';
    }
    // Атака: хвост соперника достижим раньше, чем он вернётся домой.
    if (s.enemy.alive && s.enemy.trailLength > 0) {
      const hit = bfs(s, me.x, me.y, me.dir, (j) => s.trail[j] === 2);
      if (hit && hit.dist <= enemyHomeDist(s) && hit.dist < 30) {
        plan = [];
        return hit.dir;
      }
    }
    if (me.trailLength > 0) {
      const home = homePath(s);
      if (home && enemyThreat(s) <= home.dist + 2) {
        plan = [];
        return home.dir;
      }
    }
    if (!plan.length && me.home && me.trailLength === 0) {
      const out = freestDir(s, me.x, me.y, me.dir, 4);
      const side = PERP[out][loops % 2];
      loops++;
      plan = ['exit', out, out, out, out, side, side, side, side];
    }
    while (plan.length) {
      const d = plan[0];
      if (d === 'exit') {
        const nx = me.x + DIRS[plan[1]][0];
        const ny = me.y + DIRS[plan[1]][1];
        const inLand = nx >= 0 && ny >= 0 && nx < s.width && ny < s.height && s.land[ny * s.width + nx] === 1;
        if (inLand && safeStep(s, me.x, me.y, me.dir, plan[1])) return plan[1];
        plan.shift();
        continue;
      }
      plan.shift();
      if (safeStep(s, me.x, me.y, me.dir, d)) return d;
      plan = [];
    }
    if (me.trailLength > 0) {
      const home = homePath(s);
      if (home) return home.dir;
    }
    return anySafe(s);
  },
};
