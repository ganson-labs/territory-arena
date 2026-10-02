// Canvas renderer: field, territories, heads, effects, HUD and show screens. Logical frame 1920x1080.
import { W, H, CELLS, ROUND_TICKS, TICK_RATE, MAPS } from '/kit/arena/engine.js';
import { HEAD_FRAMES, TILE_PX } from './skin-host.js';

export const VIEW_W = 1920;
export const VIEW_H = 1080;
export const CELL = 23;
export const FW = W * CELL; // 1472
export const FH = H * CELL; // 920
export const OX = (VIEW_W - FW) / 2; // 224
export const OY = 140;
const HEAD_SIZE = 64;
export const VICTORY_BOX = { x: 384, y: 150, w: 1152, h: 648 };
const HEAD = '"Russo One", "Arial Black", sans-serif';
const BODY = '"Inter", "Segoe UI", sans-serif';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const fmtPct = (v) => (Math.round(v * 10) / 10).toFixed(1);

function hexToRgb(hex) {
  const h = String(hex || '#ccc').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

const cx = (x) => OX + x * CELL + CELL / 2;
const cy = (y) => OY + y * CELL + CELL / 2;
const clock = (tick) => {
  const s = Math.ceil(tick / TICK_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.contestants = [null, null];
    this.order = [0, 1];
    this.round = null;
    this.prev = null;
    this.prevLand = new Int8Array(CELLS).fill(-1);
    this.flashes = []; // { i, kind: 'gain'|'burn', side, t0 }
    this.particles = [];
    this.popups = [];
    this.announce = [];
    this.ghosts = [];
    this.lastStepAt = 0;
    this.tickDuration = 1000 / TICK_RATE;
    this.paths = null;
    this.patterns = new Map();
    this.time = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.scale = Math.min(this.canvas.width / VIEW_W, this.canvas.height / VIEW_H);
    this.offX = (this.canvas.width - VIEW_W * this.scale) / 2;
    this.offY = (this.canvas.height - VIEW_H * this.scale) / 2;
  }

  // Physical pixel size of the victory box: the skin renders at screen resolution, capped at 1080p.
  victorySize() {
    const k = Math.min(1920 / VICTORY_BOX.w, Math.max(0.5, this.scale));
    return { w: Math.round(VICTORY_BOX.w * k), h: Math.round(VICTORY_BOX.h * k) };
  }

  // ---------- round state ----------

  newRound(round, order, contestants) {
    this.round = round;
    this.order = order;
    this.contestants = contestants;
    this.prev = this.snapshot(round);
    this.prevLand = round.land.slice();
    this.flashes = [];
    this.particles = [];
    this.popups = [];
    this.announce = [];
    this.ghosts = [];
    this.paths = null;
    this.spawnAt = [performance.now(), performance.now()];
  }

  snapshot(round) {
    return round.players.map((p) => ({ x: p.x, y: p.y, alive: p.alive }));
  }

  beforeStep(round) {
    this.prev = this.snapshot(round);
    this.prevLand = round.land.slice();
  }

  sideColor(side) {
    return this.contestants[this.order[side]]?.color || '#ccc';
  }

  afterStep(round, events) {
    const now = performance.now();
    this.lastStepAt = now;
    this.paths = null;
    // Land changes -> flashes.
    for (let i = 0; i < CELLS; i++) {
      const a = this.prevLand[i];
      const b = round.land[i];
      if (a === b) continue;
      if (b >= 0) this.flashes.push({ i, kind: 'gain', side: b, t0: now });
      else this.flashes.push({ i, kind: 'burn', side: a, t0: now + Math.random() * 250 });
    }
    for (const e of events) this.onEvent(e, round, now);
  }

  onEvent(e, round, now) {
    const color = this.sideColor(e.side);
    const c = this.contestants[this.order[e.side]];
    if (e.type === 'capture' && e.count >= 16) {
      const pct = (100 * e.count) / CELLS;
      this.popups.push({ text: `+${fmtPct(pct)}%`, x: cx(e.x), y: cy(e.y), color, size: clamp(34 + pct * 5, 38, 96), t0: now, life: 1400 });
      if (pct >= 8) this.shout(`+${fmtPct(pct)}%`, color, `${c.name}: крупный захват`);
    }
    if (e.type === 'death') {
      const x = cx(e.x);
      const y = cy(e.y);
      for (let k = 0; k < 46; k++) {
        const a = Math.random() * Math.PI * 2;
        const v = 120 + Math.random() * 520;
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.7, age: 0, size: 4 + Math.random() * 8, color });
      }
      const p = this.prev?.[e.side];
      this.ghosts.push({ side: e.side, x, y, dir: round.players[e.side].dir, t0: now, ci: this.order[e.side] });
      const killer = e.by != null ? this.contestants[this.order[e.by]] : null;
      const lost = `−${fmtPct((100 * e.lostCells) / CELLS)}%`;
      if (e.cause === 'cut') this.shout('ХВОСТ СРЕЗАН!', killer.color, `${killer.name} → ${c.name}: ${lost}`);
      else if (e.cause === 'self') this.shout('СВОЙ ХВОСТ!', color, `${c.name}: ${lost}`);
      else if (e.cause === 'wall') this.shout('В КРАЙ ПОЛЯ!', color, `${c.name}: ${lost}`);
      else if (e.cause === 'head') this.shout('ЛОБ В ЛОБ!', '#ffffff', `${c.name}: ${lost}`);
      else this.shout('ОКРУЖЁН!', color, `${c.name}: ${lost}`);
      void p;
    }
    if (e.type === 'respawn') this.spawnAt[e.side] = now;
  }

  shout(text, color, sub = '') {
    this.announce.push({ text, color, sub, t0: performance.now() });
    if (this.announce.length > 2) this.announce.shift();
  }

  update(dt) {
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  // ---------- patterns & paths ----------

  pattern(c, kind) {
    const key = `${c.id}:${kind}:${c.artVersion}`;
    let p = this.patterns.get(key);
    if (!p) {
      p = this.ctx.createPattern(c.art[kind], 'repeat');
      this.patterns.set(key, p);
    }
    const k = (4 * CELL) / TILE_PX;
    p.setTransform(new DOMMatrix().translateSelf(OX, OY).scaleSelf(k, k));
    return p;
  }

  buildPaths(round) {
    const fill = [new Path2D(), new Path2D()];
    const edge = [new Path2D(), new Path2D()];
    const trail = [new Path2D(), new Path2D()];
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        const s = round.land[y * W + x];
        let x2 = x + 1;
        while (x2 < W && round.land[y * W + x2] === s) x2++;
        if (s >= 0) fill[s].rect(OX + x * CELL, OY + y * CELL, (x2 - x) * CELL, CELL);
        x = x2;
      }
    }
    for (let i = 0; i < CELLS; i++) {
      const s = round.land[i];
      if (s < 0) continue;
      const x = i % W;
      const y = (i / W) | 0;
      const X = OX + x * CELL;
      const Y = OY + y * CELL;
      const e = edge[s];
      if (y === 0 || round.land[i - W] !== s) { e.moveTo(X, Y); e.lineTo(X + CELL, Y); }
      if (y === H - 1 || round.land[i + W] !== s) { e.moveTo(X, Y + CELL); e.lineTo(X + CELL, Y + CELL); }
      if (x === 0 || round.land[i - 1] !== s) { e.moveTo(X, Y); e.lineTo(X, Y + CELL); }
      if (x === W - 1 || round.land[i + 1] !== s) { e.moveTo(X + CELL, Y); e.lineTo(X + CELL, Y + CELL); }
    }
    for (const p of round.players) {
      for (const i of p.trail) trail[p.side].rect(OX + (i % W) * CELL + 2, OY + ((i / W) | 0) * CELL + 2, CELL - 4, CELL - 4);
    }
    this.paths = { fill, edge, trail };
  }

  // ---------- drawing ----------

  begin() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
  }

  drawField(alpha, now) {
    const ctx = this.ctx;
    const round = this.round;
    ctx.fillStyle = '#15171b';
    ctx.fillRect(OX, OY, FW, FH);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < W; x++) { ctx.moveTo(OX + x * CELL, OY); ctx.lineTo(OX + x * CELL, OY + FH); }
    for (let y = 1; y < H; y++) { ctx.moveTo(OX, OY + y * CELL); ctx.lineTo(OX + FW, OY + y * CELL); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(OX - 1, OY - 1, FW + 2, FH + 2);

    if (!this.paths) this.buildPaths(round);
    const { fill, edge, trail } = this.paths;
    for (let s = 0; s < 2; s++) {
      const c = this.contestants[this.order[s]];
      ctx.fillStyle = this.pattern(c, 'land');
      ctx.fill(fill[s]);
    }
    // Bases: a quiet frame, they can never be taken.
    for (let s = 0; s < 2; s++) {
      const b = round.map.bases[s];
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeRect(OX + (b.x - 1) * CELL + 3, OY + (b.y - 1) * CELL + 3, 3 * CELL - 6, 3 * CELL - 6);
      ctx.setLineDash([]);
    }
    for (let s = 0; s < 2; s++) {
      ctx.strokeStyle = this.sideColor(s);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke(edge[s]);
    }

    // Flashes: captured cells glow white, burnt cells smoulder.
    const keep = [];
    for (const f of this.flashes) {
      const k = (now - f.t0) / (f.kind === 'gain' ? 600 : 900);
      if (k >= 1) continue;
      keep.push(f);
      if (k < 0) continue;
      const x = OX + (f.i % W) * CELL;
      const y = OY + ((f.i / W) | 0) * CELL;
      if (f.kind === 'gain') ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k)})`;
      else ctx.fillStyle = rgba(this.sideColor(f.side), 0.7 * (1 - k));
      ctx.fillRect(x, y, CELL, CELL);
    }
    this.flashes = keep;

    // Trails.
    for (let s = 0; s < 2; s++) {
      const p = round.players[s];
      if (!p.trail.length) continue;
      const c = this.contestants[this.order[s]];
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = this.pattern(c, 'trail');
      ctx.fill(trail[s]);
      ctx.restore();
      ctx.strokeStyle = rgba(c.color, 0.9);
      ctx.lineWidth = 2;
      ctx.stroke(trail[s]);
    }

    // Ghosts of the fallen.
    this.ghosts = this.ghosts.filter((g) => now - g.t0 < 900);
    for (const g of this.ghosts) {
      const k = (now - g.t0) / 900;
      const c = this.contestants[g.ci];
      const img = c.art.heads[g.dir]?.[0];
      if (!img) continue;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.translate(g.x, g.y - k * 40);
      ctx.rotate(k * 4);
      const s = HEAD_SIZE * (1 + k * 0.8);
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.drawImage(img, -s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // Heads.
    for (let s = 0; s < 2; s++) {
      const p = round.players[s];
      if (!p.alive) continue;
      const pr = this.prev?.[s];
      const jump = !pr || !pr.alive || Math.abs(pr.x - p.x) + Math.abs(pr.y - p.y) > 1;
      const x = jump ? cx(p.x) : lerp(cx(pr.x), cx(p.x), alpha);
      const y = jump ? cy(p.y) : lerp(cy(pr.y), cy(p.y), alpha);
      const c = this.contestants[this.order[s]];
      const pop = easeOut((now - (this.spawnAt?.[s] ?? 0)) / 350);
      const size = HEAD_SIZE * (0.4 + 0.6 * pop);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(x + 3, y + 8, size * 0.42, size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.52, 0, Math.PI * 2);
      ctx.stroke();
      const frames = c.art.heads[p.dir] || c.art.heads.right;
      const img = frames[Math.floor(now / 100) % HEAD_FRAMES];
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      ctx.restore();
    }

    // Particles.
    for (const p of this.particles) {
      const k = p.age / p.life;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Popups.
    this.popups = this.popups.filter((p) => now - p.t0 < p.life);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const k = (now - p.t0) / p.life;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `${Math.round(p.size * (0.8 + 0.2 * easeOut(k * 4)))}px ${HEAD}`;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(p.text, p.x, p.y - k * 50);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 20;
      ctx.fillText(p.text, p.x, p.y - k * 50);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  drawAnnouncements(now) {
    const ctx = this.ctx;
    this.announce = this.announce.filter((a) => now - a.t0 < 2200);
    this.announce.forEach((a, n) => {
      const k = (now - a.t0) / 2200;
      const y = OY + 150 + n * 140;
      ctx.save();
      ctx.globalAlpha = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
      const s = 1 + 0.3 * (1 - easeOut(k * 6));
      ctx.translate(VIEW_W / 2, y);
      ctx.scale(s, s);
      ctx.textAlign = 'center';
      ctx.font = `64px ${HEAD}`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(a.text, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 30;
      ctx.fillText(a.text, 0, 0);
      if (a.sub) {
        ctx.shadowBlur = 0;
        ctx.font = `600 36px ${BODY}`;
        ctx.lineWidth = 8;
        ctx.strokeText(a.sub, 0, 50);
        ctx.fillStyle = a.color;
        ctx.fillText(a.sub, 0, 50);
      }
      ctx.restore();
    });
  }

  percentOf(ci) {
    const side = this.order.indexOf(ci);
    return (100 * this.round.players[side].cells) / CELLS;
  }

  drawHud(ui, now) {
    const ctx = this.ctx;
    const round = this.round;
    const [A, B] = this.contestants;
    // Timer and round label.
    const left = Math.max(0, ROUND_TICKS - round.tick);
    const hurry = left <= 10 * TICK_RATE && ui.phase === 'fight';
    ctx.textAlign = 'center';
    ctx.font = `600 26px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const label = ui.roundLabel || `РАУНД ${ui.roundIndex + 1}`;
    ctx.fillText(`${label} · ${round.map.name.toUpperCase()}`, VIEW_W / 2, 32);
    ctx.save();
    if (hurry) {
      const pulse = 1 + 0.08 * Math.max(0, Math.sin(now / 80));
      ctx.translate(VIEW_W / 2, 90);
      ctx.scale(pulse, pulse);
      ctx.translate(-VIEW_W / 2, -90);
    }
    ctx.font = `68px ${HEAD}`;
    ctx.fillStyle = hurry ? '#ff5d5d' : '#ffffff';
    ctx.fillText(clock(left), VIEW_W / 2, 96);
    ctx.restore();
    if (ui.speed !== 1) {
      ctx.font = `700 28px ${BODY}`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(`×${ui.speed}`, VIEW_W / 2 + 100, 92);
      ctx.textAlign = 'center';
    }
    // Round wins next to the timer.
    if (ui.score) {
      ctx.font = `64px ${HEAD}`;
      ctx.fillStyle = A.color;
      ctx.fillText(String(ui.score[0]), VIEW_W / 2 - 220, 96);
      ctx.fillStyle = B.color;
      ctx.fillText(String(ui.score[1]), VIEW_W / 2 + 220, 96);
    }
    // Tug-of-war bar.
    const pa = this.percentOf(0);
    const pb = this.percentOf(1);
    const bx = OX;
    const bw = FW;
    const by = 112;
    const bh = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = A.color;
    ctx.fillRect(bx, by, (bw * pa) / 100, bh);
    ctx.fillStyle = B.color;
    ctx.fillRect(bx + bw - (bw * pb) / 100, by, (bw * pb) / 100, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(bx + bw / 2 - 1, by - 4, 2, bh + 8);
    // Side panels.
    this.drawPanel(A, 0, pa, now);
    this.drawPanel(B, 1, pb, now);
  }

  drawPanel(c, ci, pct, now) {
    const ctx = this.ctx;
    const x = ci === 0 ? OX / 2 : VIEW_W - OX / 2;
    const side = this.order.indexOf(ci);
    const p = this.round.players[side];
    ctx.save();
    const g = ctx.createLinearGradient(0, OY, 0, OY + FH);
    g.addColorStop(0, rgba(c.color, 0.22));
    g.addColorStop(1, rgba(c.color, 0.02));
    ctx.fillStyle = g;
    ctx.fillRect(ci === 0 ? 12 : VIEW_W - OX + 12, OY, OX - 24, FH);
    ctx.textAlign = 'center';
    ctx.font = `700 24px ${BODY}`;
    ctx.fillStyle = c.color;
    this.fitText(c.model.toUpperCase(), x, OY + 40, OX - 36, 24, `700 {}px ${BODY}`);
    const img = c.art.portrait[Math.floor(now / 110) % HEAD_FRAMES];
    if (!p.alive) ctx.globalAlpha = 0.3;
    ctx.drawImage(img, x - 90, OY + 60, 180, 180);
    ctx.globalAlpha = 1;
    if (!p.alive) {
      ctx.font = `64px ${HEAD}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(String(Math.ceil(p.respawnIn / TICK_RATE)), x, OY + 172);
    }
    ctx.fillStyle = '#fff';
    this.wrapName(c.name.toUpperCase(), x, OY + 290, OX - 30);
    ctx.font = `76px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = c.color;
    ctx.shadowBlur = 24;
    ctx.fillText(fmtPct(pct), x, OY + 470);
    ctx.shadowBlur = 0;
    ctx.font = `36px ${HEAD}`;
    ctx.fillStyle = c.color;
    ctx.fillText('% ПОЛЯ', x, OY + 515);
    ctx.font = `600 28px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`срезал  ${p.tally.kills}`, x, OY + 610);
    ctx.fillText(`погиб  ${p.tally.deaths}`, x, OY + 655);
    if (p.trail.length) {
      ctx.fillStyle = c.color;
      ctx.fillText(`хвост  ${p.trail.length}`, x, OY + 700);
    }
    ctx.restore();
  }

  fitText(text, x, y, maxW, size, fontTpl) {
    const ctx = this.ctx;
    let s = size;
    ctx.font = fontTpl.replace('{}', s);
    while (s > 12 && ctx.measureText(text).width > maxW) {
      s -= 2;
      ctx.font = fontTpl.replace('{}', s);
    }
    ctx.fillText(text, x, y);
  }

  wrapName(text, x, y, maxW) {
    const ctx = this.ctx;
    let size = 36;
    const words = text.split(/\s+/);
    for (; size >= 20; size -= 2) {
      ctx.font = `${size}px ${HEAD}`;
      const lines = [];
      let cur = '';
      for (const w of words) {
        const t = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(t).width <= maxW || !cur) cur = t;
        else {
          lines.push(cur);
          cur = w;
        }
      }
      lines.push(cur);
      if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= maxW)) {
        lines.forEach((l, i) => ctx.fillText(l, x, y + i * (size + 6) - ((lines.length - 1) * (size + 6)) / 2));
        return;
      }
    }
    this.fitText(text, x, y, maxW, 20, `{}px ${HEAD}`);
  }

  dim(a) {
    this.ctx.fillStyle = `rgba(5,6,8,${a})`;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawCountdown(ui, now) {
    const ctx = this.ctx;
    const t = (now - ui.countdown.start) / 1000;
    const n = 3 - Math.floor(t);
    if (n <= 0) return;
    const k = t % 1;
    ctx.save();
    ctx.fillStyle = 'rgba(5,6,8,0.35)';
    ctx.fillRect(OX, OY, FW, FH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1 - k * 0.6;
    ctx.font = `${Math.round(300 * (1.3 - 0.3 * easeOut(k * 3)))}px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(n), VIEW_W / 2, OY + FH / 2);
    ctx.restore();
  }

  drawVictoryScreen(c, title, line1, line2, now, t0) {
    const ctx = this.ctx;
    const k = easeOut((now - t0) / 500);
    this.dim(0.92 * k);
    ctx.save();
    ctx.globalAlpha = k;
    const b = VICTORY_BOX;
    if (c) {
      const g = ctx.createRadialGradient(VIEW_W / 2, b.y + b.h / 2, 50, VIEW_W / 2, b.y + b.h / 2, b.w * 0.7);
      g.addColorStop(0, rgba(c.color, 0.25));
      g.addColorStop(1, rgba(c.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      c.skin.drawVictory(ctx, b.x, b.y, b.w, b.h);
    }
    ctx.textAlign = 'center';
    ctx.font = `600 34px ${BODY}`;
    ctx.fillStyle = c ? c.color : '#fff';
    ctx.fillText(title, VIEW_W / 2, c ? 120 : 380);
    ctx.font = `84px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = c ? c.color : '#fff';
    ctx.shadowBlur = 30;
    this.fitText(line1, VIEW_W / 2, c ? 890 : 520, 1700, 84, `{}px ${HEAD}`);
    ctx.shadowBlur = 0;
    ctx.font = `600 48px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(line2, VIEW_W / 2, c ? 970 : 610);
    ctx.restore();
  }

  drawRoundEnd(ui, now) {
    const bn = ui.banner;
    const c = bn.winner != null ? this.contestants[bn.winner] : null;
    const [pa, pb] = bn.percent;
    this.drawVictoryScreen(
      c,
      c ? `ПОБЕДА В РАУНДЕ ${ui.roundIndex + 1}` : `РАУНД ${ui.roundIndex + 1}`,
      c ? c.name.toUpperCase() : 'НИЧЬЯ',
      `${this.contestants[0].name} ${fmtPct(pa)}%  :  ${fmtPct(pb)}% ${this.contestants[1].name}`,
      now,
      bn.start,
    );
  }

  drawReview(ui, now) {
    const ctx = this.ctx;
    const r = ui.review;
    const [A, B] = this.contestants;
    this.dim(0.94);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `600 34px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`ТУРНИР С ДОРАБОТКОЙ · РАУНД ${r.done} ИЗ ${r.total} СЫГРАН`, VIEW_W / 2, 150);
    ctx.font = `96px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(r.finished ? 'ТУРНИР ОКОНЧЕН' : 'ВРЕМЯ НА ДОРАБОТКУ', VIEW_W / 2, 270);
    // Score.
    const yS = 470;
    for (const [c, ci] of [[A, 0], [B, 1]]) {
      const x = ci === 0 ? VIEW_W / 2 - 420 : VIEW_W / 2 + 420;
      ctx.drawImage(c.art.portrait[Math.floor(now / 110) % HEAD_FRAMES], x - 110, yS - 200, 220, 220);
      ctx.font = `44px ${HEAD}`;
      ctx.fillStyle = c.color;
      this.fitText(c.name.toUpperCase(), x, yS + 70, 560, 44, `{}px ${HEAD}`);
      ctx.font = `600 32px ${BODY}`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`в последнем раунде ${fmtPct(r.lastPercent[ci])}%`, x, yS + 120);
    }
    ctx.font = `150px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(`${r.score[0]} : ${r.score[1]}`, VIEW_W / 2, yS);
    ctx.font = `600 32px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const lines = r.saved.length ? ['Сводки и реплеи записаны:', ...r.saved] : ['Файлы раунда не записаны: это спарринг-боты, у них нет папки участника.'];
    lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 720 + i * 46));
    if (r.error) {
      ctx.fillStyle = '#ff6b7a';
      ctx.fillText(r.error, VIEW_W / 2, 720 + lines.length * 46);
    }
    ctx.font = `600 36px ${BODY}`;
    ctx.fillStyle = '#ffd36b';
    if (!r.finished) ctx.fillText(`N или кнопка — раунд ${r.done + 1}, команды загрузятся с диска заново`, VIEW_W / 2, 935);
    ctx.restore();
  }

  drawMatchEnd(ui, now) {
    const m = ui.matchEnd;
    const c = m.winner != null ? this.contestants[m.winner] : null;
    this.drawVictoryScreen(
      c,
      ui.matchEnd.tournament ? 'ПОБЕДИТЕЛЬ ТУРНИРА' : 'ПОБЕДИТЕЛЬ МАТЧА',
      c ? c.name.toUpperCase() : 'НИЧЬЯ',
      `${this.contestants[0].name} ${m.score[0]} : ${m.score[1]} ${this.contestants[1].name}`,
      now,
      m.start,
    );
  }

  drawIntro(now, ui) {
    const ctx = this.ctx;
    const t = (now - ui.introStart) / 1000;
    const [A, B] = this.contestants;
    const slant = 120;
    const inA = easeOut(t / 0.6);
    for (const [c, i] of [[A, 0], [B, 1]]) {
      const g = i === 0 ? ctx.createLinearGradient(0, 0, VIEW_W / 2, 0) : ctx.createLinearGradient(VIEW_W, 0, VIEW_W / 2, 0);
      g.addColorStop(0, rgba(c.color, 0.3));
      g.addColorStop(1, rgba(c.color, 0.04));
      ctx.fillStyle = g;
      ctx.beginPath();
      if (i === 0) {
        ctx.moveTo(0, 0);
        ctx.lineTo((VIEW_W / 2 + slant) * inA, 0);
        ctx.lineTo((VIEW_W / 2 - slant) * inA, VIEW_H);
        ctx.lineTo(0, VIEW_H);
      } else {
        ctx.moveTo(VIEW_W, 0);
        ctx.lineTo(VIEW_W - (VIEW_W / 2 - slant) * inA, 0);
        ctx.lineTo(VIEW_W - (VIEW_W / 2 + slant) * inA, VIEW_H);
        ctx.lineTo(VIEW_W, VIEW_H);
      }
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(VIEW_W / 2 + slant, 0);
    ctx.lineTo(VIEW_W / 2 - slant, VIEW_H);
    ctx.stroke();
    for (const [c, i] of [[A, 0], [B, 1]]) {
      const k = easeOut((t - 0.3 - i * 0.25) / 0.7);
      if (k <= 0) continue;
      const x = i === 1 ? VIEW_W - 480 : 480;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.translate((i === 1 ? 1 : -1) * (1 - k) * 200, 0);
      const img = c.art.portrait[Math.floor(now / 110) % HEAD_FRAMES];
      ctx.drawImage(img, x - 230, 90, 460, 460);
      ctx.textAlign = 'center';
      ctx.font = `700 30px ${BODY}`;
      ctx.fillStyle = c.color;
      ctx.fillText(c.model.toUpperCase(), x, 620);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 24;
      this.fitText(c.name.toUpperCase(), x, 712, 760, 80, `{}px ${HEAD}`);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      this.wrapMotto(c.motto ? `«${c.motto}»` : '', x, 790, 720);
      ctx.restore();
    }
    const kv = easeOut((t - 1.1) / 0.4);
    if (kv > 0) {
      ctx.save();
      ctx.globalAlpha = kv;
      ctx.textAlign = 'center';
      ctx.font = `${Math.round(150 * (1.6 - kv * 0.6))}px ${HEAD}`;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(255,255,255,0.6)';
      ctx.shadowBlur = 30;
      ctx.fillText('VS', VIEW_W / 2, 400);
      ctx.restore();
    }
    if (t > 2.5) {
      ctx.textAlign = 'center';
      ctx.font = `600 28px ${BODY}`;
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.2 * Math.sin(now / 400)})`;
      ctx.fillText('ПРОБЕЛ — В БОЙ', VIEW_W / 2, 1030);
    }
  }

  wrapMotto(text, x, y, maxW) {
    const ctx = this.ctx;
    ctx.font = `italic 500 36px ${BODY}`;
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, x, y + i * 46));
  }

  drawMenuBackdrop(now) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.5;
    const s = 46;
    for (let y = 0; y < VIEW_H / s; y++) {
      for (let x = 0; x < VIEW_W / s; x++) {
        const v = Math.sin(x * 0.4 + now / 1500) + Math.cos(y * 0.5 - now / 1900);
        if (v > 1.1) ctx.fillStyle = 'rgba(232,130,90,0.18)';
        else if (v < -1.1) ctx.fillStyle = 'rgba(79,195,201,0.18)';
        else continue;
        ctx.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
      }
    }
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.font = `120px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText('ЗАХВАТ ТЕРРИТОРИИ', VIEW_W / 2, 300);
  }

  drawPause() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(5,6,8,0.45)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = `110px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText('ПАУЗА', VIEW_W / 2, VIEW_H / 2 + 40);
  }

  drawDebug(lines) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 20px Consolas, monospace';
    ctx.textAlign = 'left';
    const h = 28 * lines.length + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(OX, VIEW_H - h - 20, FW, h);
    ctx.fillStyle = '#ffd36b';
    lines.forEach((l, i) => ctx.fillText(l.slice(0, 130), OX + 12, VIEW_H - h - 20 + 32 + i * 28));
    ctx.restore();
  }

  frame(now, dt, ui) {
    this.update(dt);
    this.begin();
    if (ui.phase === 'menu' || ui.phase === 'loading') {
      this.drawMenuBackdrop(now);
      return;
    }
    if (ui.phase === 'intro') {
      this.drawIntro(now, ui);
      return;
    }
    if (this.round) {
      const alpha = ui.phase === 'fight' ? clamp((now - this.lastStepAt) / this.tickDuration, 0, 1) : 1;
      this.drawField(alpha, now);
      this.drawHud(ui, now);
      if (ui.phase === 'countdown') this.drawCountdown(ui, now);
      if (ui.phase === 'fight' || ui.phase === 'countdown') this.drawAnnouncements(now);
      if (ui.phase === 'roundEnd' && ui.banner) this.drawRoundEnd(ui, now);
      if (ui.phase === 'review' && ui.review) this.drawReview(ui, now);
      if (ui.paused) this.drawPause();
    }
    if (ui.phase === 'matchEnd') this.drawMatchEnd(ui, now);
  }
}

export { MAPS };
