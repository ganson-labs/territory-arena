// Тестовый соперник: едет к ближайшей клетке чужого хвоста, иначе кружит у базы.
// едет к ближайшей клетке хвоста соперника, если есть, иначе делает петли
let loops = 0, st = null;
export default {
  init() { st = null; },
  tick(s) {
    const me = s.me;
    if (!me.alive) { st = null; return { turn: 0 }; }
    // ближайший хвост соперника (мои клетки trail==2 с её точки зрения)
    let best = null, bd = 1e9;
    for (let i = 0; i < s.trail.length; i++) if (s.trail[i] === 2) {
      const x = (i % s.cols) * 10 + 5, y = Math.floor(i / s.cols) * 10 + 5;
      const d = Math.hypot(x - me.x, y - me.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (best) return { heading: Math.atan2(best.y - me.y, best.x - me.x) * 180 / Math.PI };
    // иначе круг по базе
    return { turn: me.home ? 0.4 : 0.6 };
  },
};
