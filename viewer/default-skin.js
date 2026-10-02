// Simple built-in look, used when a team has no skin.js or its skin fails.
const ANG = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

export const defaultSkin = {
  head(ctx, { size, dir, frame, frames, color }) {
    const c = size / 2;
    const bob = Math.sin((frame / frames) * Math.PI * 2) * size * 0.02;
    ctx.save();
    ctx.translate(c, c + bob);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(-size * 0.1, -size * 0.12, size * 0.14, 0, Math.PI * 2);
    ctx.fill();
    const a = ANG[dir] ?? Math.PI / 2;
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    for (const s of [-1, 1]) {
      const ex = fx * size * 0.12 - fy * s * size * 0.13;
      const ey = fy * size * 0.12 + fx * s * size * 0.13;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex, ey, size * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(ex + fx * size * 0.035, ey + fy * size * 0.035, size * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  land(ctx, { size, color }) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.62;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#000';
    const s = size / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) ctx.fillRect(x * s, y * s, s, s);
  },

  trail(ctx, { size, color, accent }) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = accent;
    const s = size / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        ctx.beginPath();
        ctx.arc(x * s + s / 2, y * s + s / 2, s * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  victory(ctx, { width, height, t, color, accent }) {
    const cx = width / 2;
    const cy = height / 2;
    const R = Math.max(width, height) * 0.7;
    for (let k = 0; k < 6; k++) {
      const r = ((t * 0.6 + k / 6) % 1) * R;
      ctx.strokeStyle = k % 2 ? color : accent;
      ctx.globalAlpha = 1 - r / R;
      ctx.lineWidth = height * 0.02;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) {
      const x = rnd() * width;
      const y = ((rnd() * height + t * height * (0.25 + rnd() * 0.3)) % (height * 1.1)) - height * 0.05;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * (2 + rnd() * 4));
      ctx.fillStyle = rnd() < 0.5 ? color : accent;
      ctx.fillRect(-height * 0.012, -height * 0.006, height * 0.024, height * 0.012);
      ctx.restore();
    }
    const k = Math.min(1, t / 0.5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
    ctx.translate(-height * 0.3, -height * 0.3);
    this.head(ctx, { size: height * 0.6, dir: 'down', frame: Math.floor(t * 10) % 8, frames: 8, color, accent });
    ctx.restore();
  },
};
