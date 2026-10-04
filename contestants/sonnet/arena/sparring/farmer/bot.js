// Sparring «Пахарь»: careful rectangular loops, hurries home when the enemy gets close.
import { farm } from '../common.js';

let st = { points: [], loops: 0 };

export default {
  init() {
    st = { points: [], loops: 0 };
  },
  tick(s) {
    if (!s.me.alive) {
      st.points = [];
      return { turn: 0 };
    }
    return farm(s, st, (n) => 160 + (n % 3) * 70, 140);
  },
};
