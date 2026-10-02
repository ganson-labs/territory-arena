// Стартовый шаблон облика. Замени всё: API — в ARENA.md, раздел «Облик».
// draw вызывается каждый кадр; f.mode — 'arena', 'intro' или 'victory'.

export default {
  draw(ctx, f) {
    if (f.mode !== 'arena') {
      ctx.fillStyle = f.color;
      ctx.font = `${Math.round(f.height / 8)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(f.name, f.width / 2, f.height / 2);
      return;
    }
    ctx.beginPath();
    for (const ring of f.land) {
      ctx.moveTo(ring[0], ring[1]);
      for (let i = 2; i < ring.length; i += 2) ctx.lineTo(ring[i], ring[i + 1]);
      ctx.closePath();
    }
    ctx.fillStyle = f.color;
    ctx.globalAlpha = 0.5;
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    if (f.trail.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(f.trail[0], f.trail[1]);
      for (let i = 2; i < f.trail.length; i += 2) ctx.lineTo(f.trail[i], f.trail[i + 1]);
      ctx.strokeStyle = f.accent;
      ctx.lineWidth = 6 * f.unit;
      ctx.stroke();
    }
    if (f.head.alive) {
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.head.x, f.head.y, 14 * f.unit, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
