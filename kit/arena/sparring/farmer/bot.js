// Спарринг «Пахарь»: аккуратно нарезает прямоугольники и спешит домой, если соперник рядом.
import { DIRS, PERP, safeStep, homePath, anySafe, enemyThreat, freestDir } from '../common.js';

let plan = [];
let loops = 0;

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
    if (me.trailLength > 0) {
      const home = homePath(s);
      if (home && enemyThreat(s) <= home.dist + 3) {
        plan = [];
        return home.dir;
      }
    }
    if (!plan.length && me.home && me.trailLength === 0) {
      const out = freestDir(s, me.x, me.y, me.dir, 8);
      const side = PERP[out][loops % 2];
      const size = 6 + (loops % 3) * 2;
      loops++;
      plan = ['exit', out, ...Array(size).fill(out), ...Array(size).fill(side)];
    }
    while (plan.length) {
      let d = plan[0];
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
