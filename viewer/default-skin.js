// Built-in look, used when a team has no skin.js or its skin fails or is too slow.
// Same API as a team skin: draw(ctx, f) every frame.
const RAD = Math.PI / 180;

function ringsPath(ctx, rings) {
  ctx.beginPath();
  for (const r of rings) {
    ctx.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]);
    ctx.closePath();
  }
}

function face(ctx, x, y, size, heading, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = size * 0.12;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const fx = Math.cos(heading * RAD);
  const fy = Math.sin(heading * RAD);
  for (const s of [-1, 1]) {
    const ex = fx * size * 0.35 - fy * s * size * 0.38;
    const ey = fy * size * 0.35 + fx * s * size * 0.38;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(ex + fx * size * 0.1, ey + fy * size * 0.1, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function makeState() {
  return { fx: [] };
}

export function createDefaultSkin() {
  const st = makeState();
  return {
    draw(ctx, f) {
      if (f.mode === 'intro') return intro(ctx, f);
      if (f.mode === 'victory') return victory(ctx, f);
      const u = f.unit;
      // Land.
      if (f.land.length) {
        ringsPath(ctx, f.land);
        ctx.fillStyle = f.color;
        ctx.globalAlpha = 0.42;
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(2, u * 3);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      // Base.
      ctx.setLineDash([u * 8, u * 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(1, u * 2);
      ctx.beginPath();
      ctx.arc(f.base.x, f.base.y, f.base.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Trail.
      if (f.trail.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(f.trail[0], f.trail[1]);
        for (let i = 2; i < f.trail.length; i += 2) ctx.lineTo(f.trail[i], f.trail[i + 1]);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = f.color;
        ctx.lineWidth = u * 9;
        ctx.stroke();
        ctx.strokeStyle = f.accent;
        ctx.lineWidth = u * 3;
        ctx.stroke();
      }
      // Events.
      for (const e of f.events) {
        if (e.type === 'capture') st.fx.push({ kind: 'ring', x: e.x, y: e.y, t: 0, r: u * (40 + e.percent * 25) });
        if (e.type === 'death' || e.type === 'kill') {
          for (let k = 0; k < 30; k++) {
            const a = (k / 30) * Math.PI * 2;
            st.fx.push({ kind: 'dot', x: e.x, y: e.y, vx: Math.cos(a) * u * 300, vy: Math.sin(a) * u * 300, t: 0 });
          }
        }
        if (e.type === 'respawn') st.fx.push({ kind: 'ring', x: e.x, y: e.y, t: 0, r: u * 80 });
      }
      st.fx = st.fx.filter((p) => (p.t += f.dt) < 0.8);
      for (const p of st.fx) {
        const k = p.t / 0.8;
        ctx.globalAlpha = 1 - k;
        if (p.kind === 'ring') {
          ctx.strokeStyle = f.accent;
          ctx.lineWidth = u * 4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * k, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = f.color;
          ctx.fillRect(p.x + p.vx * p.t - u * 4, p.y + p.vy * p.t - u * 4, u * 8, u * 8);
        }
      }
      ctx.globalAlpha = 1;
      // Head.
      if (f.head.alive) face(ctx, f.head.x, f.head.y, u * 16, f.head.heading, f.color);
    },
  };
}

function intro(ctx, f) {
  const { width: w, height: h, t } = f;
  const k = Math.min(1, t / 0.6);
  face(ctx, w / 2, h * 0.38, h * 0.22 * (0.7 + 0.3 * k), 90 + Math.sin(t * 2) * 10, f.color);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(h * 0.09)}px "Russo One", sans-serif`;
  ctx.fillText(f.name.toUpperCase(), w / 2, h * 0.76, w * 0.92);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `italic 500 ${Math.round(h * 0.04)}px Inter, sans-serif`;
  if (f.motto) ctx.fillText(`«${f.motto}»`, w / 2, h * 0.86, w * 0.92);
}

function victory(ctx, f) {
  const { width: w, height: h, t } = f;
  const R = Math.max(w, h) * 0.7;
  for (let k = 0; k < 6; k++) {
    const r = ((t * 0.6 + k / 6) % 1) * R;
    ctx.strokeStyle = k % 2 ? f.color : f.accent;
    ctx.globalAlpha = 1 - r / R;
    ctx.lineWidth = h * 0.02;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 80; i++) {
    const x = rnd() * w;
    const y = ((rnd() * h + t * h * (0.25 + rnd() * 0.3)) % (h * 1.1)) - h * 0.05;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * (2 + rnd() * 4));
    ctx.fillStyle = rnd() < 0.5 ? f.color : f.accent;
    ctx.fillRect(-h * 0.012, -h * 0.006, h * 0.024, h * 0.012);
    ctx.restore();
  }
  face(ctx, w / 2, h * 0.45, h * 0.25 * Math.min(1, 0.6 + t), 90, f.color);
}
