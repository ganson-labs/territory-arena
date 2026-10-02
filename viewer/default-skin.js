// Built-in look: deliberately plain. Used when a team has no skin.js or its skin fails or is too slow.
// Same API as a team skin: draw(ctx, f) every frame.

function ringsPath(ctx, rings) {
  ctx.beginPath();
  for (const r of rings) {
    ctx.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]);
    ctx.closePath();
  }
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function createDefaultSkin() {
  return {
    draw(ctx, f) {
      if (f.mode !== 'arena') {
        const { width: w, height: h } = f;
        dot(ctx, w / 2, h * 0.4, h * 0.16, f.color);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.round(h * 0.08)}px sans-serif`;
        ctx.fillText(f.name, w / 2, h * 0.75, w * 0.92);
        if (f.mode === 'intro' && f.motto) {
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.font = `${Math.round(h * 0.04)}px sans-serif`;
          ctx.fillText(f.motto, w / 2, h * 0.85, w * 0.92);
        }
        return;
      }
      const u = f.unit;
      if (f.land.length) {
        ringsPath(ctx, f.land);
        ctx.fillStyle = f.color;
        ctx.globalAlpha = 0.4;
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(1.5, u * 2);
        ctx.stroke();
      }
      if (f.trail.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(f.trail[0], f.trail[1]);
        for (let i = 2; i < f.trail.length; i += 2) ctx.lineTo(f.trail[i], f.trail[i + 1]);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = f.color;
        ctx.lineWidth = u * 6;
        ctx.stroke();
      }
      if (f.head.alive) dot(ctx, f.head.x, f.head.y, u * 14, f.color);
    },
  };
}
