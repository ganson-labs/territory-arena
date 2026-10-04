// Sparring «Охотник»: short loops, and when the enemy trail is closer to it than the enemy is to home, cuts it.
import { farm, path, safeSteer, angleTo } from '../common.js';

let st = { points: [], loops: 0 };

function enemyHomeDistance(s) {
  const e = s.enemy;
  const p = path(s, e.x, e.y, (j) => s.land[j] === 2, (j) => s.trail[j] === 2);
  return p ? p.length * s.cell : 9999;
}

export default {
  init() {
    st = { points: [], loops: 0 };
  },
  tick(s) {
    const me = s.me;
    if (!me.alive) {
      st.points = [];
      return { turn: 0 };
    }
    if (s.enemy.alive && s.enemy.trail.length > 3) {
      let best = null;
      let bestD = Infinity;
      for (const q of s.enemy.trail.slice(0, -2)) {
        const d = Math.hypot(q.x - me.x, q.y - me.y);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
      if (best && bestD < 450 && bestD < enemyHomeDistance(s) + 40) {
        st.points = [];
        return safeSteer(s, { heading: angleTo(me, best.x, best.y) });
      }
    }
    return farm(s, st, (n) => 110 + (n % 2) * 50, 90);
  },
};
