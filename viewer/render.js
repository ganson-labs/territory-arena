// Canvas renderer: neutral stage, camera, the two team layers drawn by their skins,
// arena effects, HUD and show screens. Logical frame 1920x1080.
import { WIDTH, HEIGHT, CELLS, ROUND_TICKS, TICK_RATE, SPEED, BASE_RADIUS } from '/kit/arena/engine.js';
import { sideRings, cellsRings } from './contours.js';

export const VIEW_W = 1920;
export const VIEW_H = 1080;
export const FW = 1472;
export const FH = 920;
export const OX = (VIEW_W - FW) / 2; // 224
export const OY = 140;
export const VICTORY_BOX = { x: 384, y: 170, w: 1152, h: 648 };
const CARD = { w: 840, h: 860, y: 150 };
const HEAD = '"Russo One", "Arial Black", sans-serif';
const BODY = '"Inter", "Segoe UI", sans-serif';
const MAX_LAYER_W = 2560;
const MAX_BOX_W = 1920;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const fmtPct = (v) => (Math.round(v * 10) / 10).toFixed(1);
const angLerp = (a, b, t) => {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return a + d * t;
};

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
    this.alpha = 1;
    this.rings = [[], []];
    this.events = [[], []]; // per side, waiting for the skin
    this.fx = []; // arena effects (world coords)
    this.popups = [];
    this.announce = [];
    this.cam = { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };
    this.camTarget = { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };
    this.slowUntil = 0;
    this.slowFactor = 1;
    this.flash = 0;
    this.show = 0;
    // ?layers=native: team layers and skin boxes at the full canvas resolution (4K capture),
    // otherwise capped to keep the per-frame skin budget on big screens.
    this.nativeLayers = false;
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
    const k = this.nativeLayers ? 1 : Math.min(1, MAX_LAYER_W / (FW * this.scale));
    this.layerW = Math.round(FW * this.scale * k);
    this.layerH = Math.round(FH * this.scale * k);
  }

  boxPx(w, h) {
    const k = this.nativeLayers ? 1 : Math.min(1, MAX_BOX_W / (w * this.scale));
    return { w: Math.round(w * this.scale * k), h: Math.round(h * this.scale * k) };
  }

  // ---------- round state ----------

  newRound(round, order, contestants) {
    this.round = round;
    this.order = order;
    this.contestants = contestants;
    this.prev = this.snapshot(round);
    this.rings = [sideRings(round.land, 0), sideRings(round.land, 1)];
    this.events = [[], []];
    this.fx = [];
    this.popups = [];
    this.announce = [];
    this.cam = { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };
    this.camTarget = { ...this.cam };
    this.slowUntil = 0;
    this.slowFactor = 1;
  }

  snapshot(round) {
    return round.players.map((p) => ({ x: p.x, y: p.y, heading: p.heading, alive: p.alive }));
  }

  beforeStep(round) {
    this.prev = this.snapshot(round);
  }

  sideOf(ci) {
    return this.order.indexOf(ci);
  }

  colorOfSide(side) {
    return this.contestants[this.order[side]]?.color || '#ccc';
  }

  afterStep(round, events) {
    let landChanged = false;
    for (const e of events) {
      if (e.type === 'capture' || e.type === 'death' || e.type === 'respawn') landChanged = true;
      this.onEvent(e, round);
    }
    if (landChanged) this.rings = [sideRings(round.land, 0), sideRings(round.land, 1)];
  }

  onEvent(e, round) {
    const now = this.show;
    if (e.type === 'capture') {
      const pct = (100 * e.count) / CELLS;
      const area = e.count ? cellsRings(e.cells) : [];
      this.events[e.side].push({ type: 'capture', wx: e.x, wy: e.y, percent: pct, cells: e.count, area });
      if (e.count) this.fx.push({ kind: 'flash', area, t0: now, life: 650, color: this.colorOfSide(e.side) });
      // Merge with a fresh popup of the same team nearby, so quick small captures read as one number.
      const near = this.popups.find((q) => q.side === e.side && now - q.t0 < 700 && Math.hypot(q.wx - e.x, q.wy - e.y) < 220);
      if (near) {
        near.pct += pct;
        near.text = `+${fmtPct(near.pct)}%`;
        near.size = clamp(40 + near.pct * 6, 44, 120);
        near.t0 = now;
        near.visible = near.pct >= 1;
      } else {
        this.popups.push({ side: e.side, pct, text: `+${fmtPct(pct)}%`, wx: e.x, wy: e.y, color: this.colorOfSide(e.side), size: clamp(40 + pct * 6, 44, 120), t0: now, life: 1500, visible: pct >= 1 });
      }
      if (pct >= 6) this.shout(`+${fmtPct(pct)}%`, this.colorOfSide(e.side), `${this.contestants[this.order[e.side]].name}: крупный захват`);
    } else if (e.type === 'death') {
      const victim = this.contestants[this.order[e.side]];
      const killer = e.by != null ? this.contestants[this.order[e.by]] : null;
      this.events[e.side].push({ type: 'death', wx: e.x, wy: e.y, cause: e.cause });
      if (e.by != null) this.events[e.by].push({ type: 'kill', wx: e.x, wy: e.y, cause: e.cause });
      this.fx.push({ kind: 'shock', wx: e.x, wy: e.y, t0: now, life: 900 });
      const lostPct = (100 * e.lostCells) / CELLS;
      const lost = lostPct >= 0.05 ? `сгорело ${fmtPct(lostPct)}%` : 'без потерь';
      const big = e.cause === 'cut' || e.cause === 'head';
      // Kill cam: slow motion and a push-in on the spot.
      this.slowUntil = now + (big ? 1700 : 1000);
      this.slowFactor = big ? 0.22 : 0.45;
      this.camTarget = { x: e.x, y: e.y, zoom: big ? 1.9 : 1.35 };
      this.camRelease = this.slowUntil;
      this.flash = big ? 0.6 : 0.3;
      if (e.cause === 'cut') this.shout('ХВОСТ СРЕЗАН!', killer.color, `${killer.name} → ${victim.name}: ${lost}`);
      else if (e.cause === 'self') this.shout('СВОЙ ХВОСТ!', victim.color, `${victim.name}: ${lost}`);
      else if (e.cause === 'wall') this.shout('В КРАЙ ПОЛЯ!', victim.color, `${victim.name}: ${lost}`);
      else this.shout('ЛОБ В ЛОБ!', '#ffffff', `${victim.name}: ${lost}`);
    } else if (e.type === 'respawn') {
      this.events[e.side].push({ type: 'respawn', wx: e.x, wy: e.y });
    }
  }

  shout(text, color, sub = '') {
    this.announce.push({ text, color, sub, t0: this.show });
    if (this.announce.length > 2) this.announce.shift();
  }

  // Game-time multiplier for kill cam slow motion.
  timeScale() {
    return this.show < this.slowUntil ? this.slowFactor : 1;
  }

  updateCamera(dtShow) {
    if (this.camRelease && this.show > this.camRelease) {
      this.camTarget = { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 };
      this.camRelease = 0;
    }
    const k = 1 - Math.exp(-dtShow / 1000 * (this.camTarget.zoom > this.cam.zoom ? 6 : 3));
    this.cam.zoom = lerp(this.cam.zoom, this.camTarget.zoom, k);
    this.cam.x = lerp(this.cam.x, this.camTarget.x, k);
    this.cam.y = lerp(this.cam.y, this.camTarget.y, k);
    const hw = WIDTH / (2 * this.cam.zoom);
    const hh = HEIGHT / (2 * this.cam.zoom);
    this.cam.x = clamp(this.cam.x, hw, WIDTH - hw);
    this.cam.y = clamp(this.cam.y, hh, HEIGHT - hh);
    this.flash = Math.max(0, this.flash - dtShow / 400);
  }

  // World -> logical screen coordinates.
  sx(wx) {
    return OX + FW / 2 + (wx - this.cam.x) * (FW / WIDTH) * this.cam.zoom;
  }
  sy(wy) {
    return OY + FH / 2 + (wy - this.cam.y) * (FH / HEIGHT) * this.cam.zoom;
  }

  // ---------- skin frames ----------

  headOf(side) {
    const p = this.round.players[side];
    const pr = this.prev?.[side];
    const a = this.alpha;
    if (!pr || !pr.alive || !p.alive || Math.hypot(pr.x - p.x, pr.y - p.y) > 30) return { x: p.x, y: p.y, heading: p.heading };
    return { x: lerp(pr.x, p.x, a), y: lerp(pr.y, p.y, a), heading: angLerp(pr.heading, p.heading, a) };
  }

  arenaFrame(side, dtShow) {
    const round = this.round;
    const p = round.players[side];
    const c = this.contestants[this.order[side]];
    const W = this.layerW;
    const H = this.layerH;
    const unit = (W / WIDTH) * this.cam.zoom;
    const tx = (x) => (x - this.cam.x) * unit + W / 2;
    const ty = (y) => (y - this.cam.y) * unit + H / 2;
    const ring = (r) => {
      const o = new Float32Array(r.length);
      for (let i = 0; i < r.length; i += 2) {
        o[i] = tx(r[i]);
        o[i + 1] = ty(r[i + 1]);
      }
      return o;
    };
    const head = this.headOf(side);
    const trailPts = p.trail.length ? [...p.trail, { x: head.x, y: head.y }] : [];
    const trail = new Float32Array(trailPts.length * 2);
    trailPts.forEach((q, i) => {
      trail[2 * i] = tx(q.x);
      trail[2 * i + 1] = ty(q.y);
    });
    const e = this.round.players[1 - side];
    const eh = this.headOf(1 - side);
    const base = round.map.bases[side];
    const events = this.events[side].map((ev) => ({
      type: ev.type,
      x: tx(ev.wx),
      y: ty(ev.wy),
      ...(ev.type === 'capture' ? { percent: ev.percent, cells: ev.cells, area: ev.area.map(ring) } : {}),
      ...(ev.cause ? { cause: ev.cause } : {}),
    }));
    this.events[side] = [];
    return {
      mode: 'arena',
      t: this.show / 1000,
      dt: dtShow / 1000,
      width: W,
      height: H,
      unit,
      color: c.color,
      accent: c.accent,
      name: c.name,
      motto: c.motto,
      land: this.rings[side].map(ring),
      base: { x: tx(base.x), y: ty(base.y), r: BASE_RADIUS * unit },
      trail,
      head: { x: tx(head.x), y: ty(head.y), heading: head.heading, speed: SPEED * unit, alive: p.alive, respawnIn: p.respawnIn / TICK_RATE, home: p.alive && !p.trail.length },
      percent: (100 * p.cells) / CELLS,
      enemyPercent: (100 * e.cells) / CELLS,
      timeLeft: Math.max(0, ROUND_TICKS - round.tick) / TICK_RATE,
      enemy: { head: { x: tx(eh.x), y: ty(eh.y), heading: eh.heading, alive: e.alive }, color: this.colorOfSide(1 - side) },
      events,
    };
  }

  // ---------- drawing ----------

  begin() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
  }

  drawStage() {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(OX, OY, FW, FH);
    ctx.clip();
    const g = ctx.createRadialGradient(VIEW_W / 2, OY + FH / 2, 100, VIEW_W / 2, OY + FH / 2, FW * 0.75);
    g.addColorStop(0, '#16181d');
    g.addColorStop(1, '#0c0d10');
    ctx.fillStyle = g;
    ctx.fillRect(OX, OY, FW, FH);
    // World-space dot grid: it moves with the camera, so the push-in reads as motion.
    const step = 50;
    const r = 1.3 * this.cam.zoom;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let wy = step; wy < HEIGHT; wy += step) {
      const y = this.sy(wy);
      if (y < OY - 2 || y > OY + FH + 2) continue;
      for (let wx = step; wx < WIDTH; wx += step) {
        const x = this.sx(wx);
        if (x < OX - 2 || x > OX + FW + 2) continue;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  drawLayers(dtShow, live) {
    const ctx = this.ctx;
    const sides = [0, 1].sort((a, b) => this.round.players[a].trail.length - this.round.players[b].trail.length);
    for (const side of sides) {
      const c = this.contestants[this.order[side]];
      const img = live ? c.skin.frame(this.arenaFrame(side, dtShow)) : c.skin.peek('arena');
      if (img) ctx.drawImage(img, OX, OY, FW, FH);
    }
  }

  drawArenaFx() {
    const ctx = this.ctx;
    const now = this.show;
    ctx.save();
    ctx.beginPath();
    ctx.rect(OX, OY, FW, FH);
    ctx.clip();
    this.fx = this.fx.filter((f) => now - f.t0 < f.life);
    for (const f of this.fx) {
      const k = (now - f.t0) / f.life;
      if (f.kind === 'flash') {
        ctx.beginPath();
        for (const r of f.area) {
          ctx.moveTo(this.sx(r[0]), this.sy(r[1]));
          for (let i = 2; i < r.length; i += 2) ctx.lineTo(this.sx(r[i]), this.sy(r[i + 1]));
          ctx.closePath();
        }
        ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k) * (1 - k)})`;
        ctx.fill('evenodd');
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`;
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (f.kind === 'shock') {
        const x = this.sx(f.wx);
        const y = this.sy(f.wy);
        ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
        ctx.lineWidth = 10 * (1 - k) + 2;
        ctx.beginPath();
        ctx.arc(x, y, 20 + easeOut(k) * 260 * this.cam.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    // "+N%" popups.
    this.popups = this.popups.filter((p) => now - p.t0 < p.life);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      if (!p.visible) continue;
      const k = (now - p.t0) / p.life;
      const x = clamp(this.sx(p.wx), OX + 120, OX + FW - 120);
      const y = clamp(this.sy(p.wy), OY + 60, OY + FH - 60) - easeOut(k) * 70;
      ctx.save();
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      const s = p.size * (0.6 + 0.4 * easeOut(k * 5));
      ctx.font = `${Math.round(s)}px ${HEAD}`;
      ctx.lineWidth = s * 0.16;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 24;
      ctx.fillText(p.text, x, y);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
  }

  drawAnnouncements() {
    const ctx = this.ctx;
    const now = this.show;
    this.announce = this.announce.filter((a) => now - a.t0 < 2300);
    this.announce.forEach((a, n) => {
      const k = (now - a.t0) / 2300;
      const y = OY + 120 + n * 150;
      ctx.save();
      ctx.globalAlpha = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
      const s = 1 + 0.35 * (1 - easeOut(k * 6));
      ctx.translate(VIEW_W / 2, y);
      ctx.scale(s, s);
      ctx.textAlign = 'center';
      ctx.font = `76px ${HEAD}`;
      ctx.lineWidth = 12;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(a.text, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 34;
      ctx.fillText(a.text, 0, 0);
      if (a.sub) {
        ctx.shadowBlur = 0;
        ctx.font = `600 38px ${BODY}`;
        ctx.lineWidth = 9;
        ctx.strokeText(a.sub, 0, 54);
        ctx.fillStyle = a.color;
        ctx.fillText(a.sub, 0, 54);
      }
      ctx.restore();
    });
  }

  drawLastSeconds(ui) {
    if (ui.phase !== 'fight') return;
    const left = (ROUND_TICKS - this.round.tick) / TICK_RATE;
    if (left > 10 || left <= 0) return;
    const n = Math.ceil(left);
    const k = n - left; // 0..1 within the second
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.32 * (1 - k * 0.7);
    ctx.font = `${Math.round(460 * (1.15 - 0.15 * easeOut(k * 4)))}px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(n), VIEW_W / 2, OY + FH / 2 + 20);
    ctx.restore();
  }

  percentOf(ci) {
    return (100 * this.round.players[this.sideOf(ci)].cells) / CELLS;
  }

  drawHud(ui) {
    const ctx = this.ctx;
    const round = this.round;
    const [A, B] = this.contestants;
    const left = Math.max(0, ROUND_TICKS - round.tick);
    const hurry = left <= 10 * TICK_RATE && ui.phase === 'fight';
    ctx.textAlign = 'center';
    ctx.font = `600 26px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`${ui.roundLabel || `РАУНД ${ui.roundIndex + 1}`} · ${round.map.name.toUpperCase()}`, VIEW_W / 2, 32);
    ctx.save();
    if (hurry) {
      const pulse = 1 + 0.1 * Math.max(0, Math.sin(this.show / 90));
      ctx.translate(VIEW_W / 2, 88);
      ctx.scale(pulse, pulse);
      ctx.translate(-VIEW_W / 2, -88);
    }
    ctx.font = `66px ${HEAD}`;
    ctx.fillStyle = hurry ? '#ff5d5d' : '#ffffff';
    ctx.fillText(clock(left), VIEW_W / 2, 94);
    ctx.restore();
    if (ui.speed !== 1) {
      ctx.font = `700 26px ${BODY}`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(`×${ui.speed}`, VIEW_W / 2 + 110, 90);
      ctx.textAlign = 'center';
    }
    ctx.font = `64px ${HEAD}`;
    ctx.fillStyle = A.color;
    ctx.fillText(String(ui.score[0]), VIEW_W / 2 - 230, 94);
    ctx.fillStyle = B.color;
    ctx.fillText(String(ui.score[1]), VIEW_W / 2 + 230, 94);
    // Territory bar.
    const pa = this.percentOf(0);
    const pb = this.percentOf(1);
    const by = 112;
    const bh = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(OX, by, FW, bh);
    ctx.fillStyle = A.color;
    ctx.fillRect(OX, by, (FW * pa) / 100, bh);
    ctx.fillStyle = B.color;
    ctx.fillRect(OX + FW - (FW * pb) / 100, by, (FW * pb) / 100, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(OX + FW / 2 - 1.5, by - 5, 3, bh + 10);
    this.drawPanel(A, 0, pa, pb);
    this.drawPanel(B, 1, pb, pa);
  }

  drawPanel(c, ci, pct, other) {
    const ctx = this.ctx;
    const x = ci === 0 ? OX / 2 : VIEW_W - OX / 2;
    const p = this.round.players[this.sideOf(ci)];
    const x0 = ci === 0 ? 12 : VIEW_W - OX + 12;
    ctx.save();
    const g = ctx.createLinearGradient(0, OY, 0, OY + FH);
    g.addColorStop(0, rgba(c.color, 0.28));
    g.addColorStop(1, rgba(c.color, 0.02));
    ctx.fillStyle = g;
    ctx.fillRect(x0, OY, OX - 24, FH);
    ctx.fillStyle = c.color;
    ctx.fillRect(x0, OY, OX - 24, 8);
    ctx.textAlign = 'center';
    ctx.fillStyle = c.color;
    this.fitText(c.model.toUpperCase(), x, OY + 52, OX - 40, 26, `700 {}px ${BODY}`);
    ctx.fillStyle = '#fff';
    this.wrapName(c.name.toUpperCase(), x, OY + 140, OX - 34);
    const lead = pct > other;
    ctx.font = `${lead ? 92 : 80}px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = c.color;
    ctx.shadowBlur = lead ? 36 : 18;
    this.fitText(fmtPct(pct), x, OY + 360, OX - 30, lead ? 92 : 80, `{}px ${HEAD}`);
    ctx.shadowBlur = 0;
    ctx.font = `34px ${HEAD}`;
    ctx.fillStyle = c.color;
    ctx.fillText('% ПОЛЯ', x, OY + 410);
    if (!p.alive) {
      ctx.fillStyle = '#fff';
      this.fitText('ВОЗРОЖДЕНИЕ', x, OY + 500, OX - 40, 28, `{}px ${HEAD}`);
      ctx.font = `72px ${HEAD}`;
      ctx.fillText(String(Math.ceil(p.respawnIn / TICK_RATE)), x, OY + 575);
    }
    ctx.font = `600 30px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`срезал  ${p.tally.kills}`, x, OY + 700);
    ctx.fillText(`погиб  ${p.tally.deaths}`, x, OY + 748);
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
    const words = text.split(/\s+/);
    for (let size = 40; size >= 20; size -= 2) {
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
      if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= maxW)) {
        lines.forEach((l, i) => ctx.fillText(l, x, y + i * (size + 6) - ((lines.length - 1) * (size + 6)) / 2));
        return;
      }
    }
    this.fitText(text, x, y, maxW, 20, `{}px ${HEAD}`);
  }

  dim(a) {
    this.ctx.fillStyle = `rgba(4,5,7,${a})`;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawCountdown(ui) {
    const ctx = this.ctx;
    const t = (this.show - ui.countdown.start) / 1000;
    const n = 3 - Math.floor(t);
    if (n <= 0) return;
    const k = t % 1;
    ctx.save();
    ctx.fillStyle = 'rgba(4,5,7,0.35)';
    ctx.fillRect(OX, OY, FW, FH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1 - k * 0.6;
    ctx.font = `${Math.round(320 * (1.3 - 0.3 * easeOut(k * 3)))}px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(n), VIEW_W / 2, OY + FH / 2);
    ctx.restore();
  }

  // Winner screen: the team's own victory animation in the middle, arena text around it.
  drawVictoryScreen(c, title, line1, line2, t0) {
    const ctx = this.ctx;
    const t = (this.show - t0) / 1000;
    const k = easeOut(t / 0.5);
    this.dim(0.92 * k);
    ctx.save();
    ctx.globalAlpha = k;
    const b = VICTORY_BOX;
    if (c) {
      const g = ctx.createRadialGradient(VIEW_W / 2, b.y + b.h / 2, 50, VIEW_W / 2, b.y + b.h / 2, b.w * 0.75);
      g.addColorStop(0, rgba(c.color, 0.25));
      g.addColorStop(1, rgba(c.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const px = this.boxPx(b.w, b.h);
      const img = c.skin.frame({ mode: 'victory', t, dt: 1 / 60, width: px.w, height: px.h, color: c.color, accent: c.accent, name: c.name, motto: c.motto, percent: this.percentOf(this.contestants.indexOf(c)), events: [] });
      if (img) ctx.drawImage(img, b.x, b.y, b.w, b.h);
    }
    ctx.textAlign = 'center';
    ctx.font = `600 36px ${BODY}`;
    ctx.fillStyle = c ? c.color : '#fff';
    ctx.fillText(title, VIEW_W / 2, c ? 130 : 400);
    ctx.font = `88px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = c ? c.color : '#fff';
    ctx.shadowBlur = 30;
    this.fitText(line1, VIEW_W / 2, c ? 912 : 530, 1700, 88, `{}px ${HEAD}`);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    this.fitText(line2, VIEW_W / 2, c ? 995 : 620, 1700, 50, `600 {}px ${BODY}`);
    ctx.restore();
  }

  drawRoundEnd(ui) {
    const bn = ui.banner;
    const c = bn.winner != null ? this.contestants[bn.winner] : null;
    const [pa, pb] = bn.percent;
    this.drawVictoryScreen(
      c,
      c ? `ПОБЕДА В РАУНДЕ ${ui.roundIndex + 1}` : `РАУНД ${ui.roundIndex + 1}`,
      c ? c.name.toUpperCase() : 'НИЧЬЯ',
      `${this.contestants[0].name}  ${fmtPct(pa)}%  :  ${fmtPct(pb)}%  ${this.contestants[1].name}`,
      bn.start,
    );
  }

  drawMatchEnd(ui) {
    const m = ui.matchEnd;
    const c = m.winner != null ? this.contestants[m.winner] : null;
    this.drawVictoryScreen(
      c,
      m.tournament ? 'ПОБЕДИТЕЛЬ ТУРНИРА' : 'ПОБЕДИТЕЛЬ МАТЧА',
      c ? c.name.toUpperCase() : 'НИЧЬЯ',
      `${this.contestants[0].name}  ${m.score[0]} : ${m.score[1]}  ${this.contestants[1].name}`,
      m.start,
    );
  }

  drawReview(ui) {
    const ctx = this.ctx;
    const r = ui.review;
    const [A, B] = this.contestants;
    this.dim(0.95);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `600 34px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`ТУРНИР С ДОРАБОТКОЙ · РАУНД ${r.done} ИЗ ${r.total} СЫГРАН`, VIEW_W / 2, 170);
    ctx.font = `100px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText('ВРЕМЯ НА ДОРАБОТКУ', VIEW_W / 2, 300);
    const yS = 520;
    for (const [c, ci] of [[A, 0], [B, 1]]) {
      const x = ci === 0 ? VIEW_W / 2 - 470 : VIEW_W / 2 + 470;
      ctx.font = `52px ${HEAD}`;
      ctx.fillStyle = c.color;
      this.fitText(c.name.toUpperCase(), x, yS - 40, 640, 52, `{}px ${HEAD}`);
      ctx.font = `600 34px ${BODY}`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`в раунде ${fmtPct(r.lastPercent[ci])}% поля`, x, yS + 20);
    }
    ctx.font = `160px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(`${r.score[0]} : ${r.score[1]}`, VIEW_W / 2, yS + 40);
    ctx.font = `600 32px ${BODY}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const lines = r.saved.length ? ['Сводки и реплеи записаны:', ...r.saved] : ['Файлы раунда не записаны: у спарринг-ботов нет папки участника.'];
    lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 700 + i * 46));
    if (r.error) {
      ctx.fillStyle = '#ff6b7a';
      ctx.fillText(r.error, VIEW_W / 2, 700 + lines.length * 46);
    }
    ctx.font = `600 36px ${BODY}`;
    ctx.fillStyle = '#ffd36b';
    ctx.fillText(`N или кнопка — раунд ${r.done + 1}, команды загрузятся с диска заново`, VIEW_W / 2, 935);
    ctx.restore();
  }

  drawIntro(ui) {
    const ctx = this.ctx;
    const t = (this.show - ui.introStart) / 1000;
    const [A, B] = this.contestants;
    for (const [c, i] of [[A, 0], [B, 1]]) {
      const g = i === 0 ? ctx.createLinearGradient(0, 0, VIEW_W / 2, 0) : ctx.createLinearGradient(VIEW_W, 0, VIEW_W / 2, 0);
      g.addColorStop(0, rgba(c.color, 0.22));
      g.addColorStop(1, rgba(c.color, 0.02));
      ctx.fillStyle = g;
      ctx.fillRect(i === 0 ? 0 : VIEW_W / 2, 0, VIEW_W / 2, VIEW_H);
    }
    for (const [c, i] of [[A, 0], [B, 1]]) {
      const k = easeOut((t - 0.2 - i * 0.3) / 0.7);
      if (k <= 0) continue;
      const x = i === 0 ? 60 : VIEW_W - 60 - CARD.w;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.translate((i === 1 ? 1 : -1) * (1 - k) * 160, 0);
      ctx.textAlign = 'center';
      ctx.font = `700 34px ${BODY}`;
      ctx.fillStyle = c.color;
      ctx.fillText(c.model.toUpperCase(), x + CARD.w / 2, 110);
      const px = this.boxPx(CARD.w, CARD.h);
      const img = c.skin.frame({ mode: 'intro', t: Math.max(0, t - 0.2 - i * 0.3), dt: 1 / 60, width: px.w, height: px.h, color: c.color, accent: c.accent, name: c.name, motto: c.motto, events: [] });
      if (img) ctx.drawImage(img, x, CARD.y, CARD.w, CARD.h);
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
      ctx.fillText('VS', VIEW_W / 2, 600);
      ctx.restore();
    }
    if (t > 2.5 && !ui.noHint) {
      ctx.textAlign = 'center';
      ctx.font = `600 28px ${BODY}`;
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.2 * Math.sin(this.show / 400)})`;
      ctx.fillText('ПРОБЕЛ — В БОЙ', VIEW_W / 2, 1050);
    }
  }

  drawMenuBackdrop() {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.font = `120px ${HEAD}`;
    ctx.fillStyle = '#fff';
    ctx.fillText('ЗАХВАТ ТЕРРИТОРИИ', VIEW_W / 2, 300);
  }

  drawPause() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(4,5,7,0.45)';
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
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(OX, VIEW_H - h - 20, FW, h);
    ctx.fillStyle = '#ffd36b';
    lines.forEach((l, i) => ctx.fillText(l.slice(0, 135), OX + 12, VIEW_H - h - 20 + 32 + i * 28));
    ctx.restore();
  }

  frame(show, dtShow, ui, alpha) {
    this.show = show;
    this.alpha = alpha;
    this.begin();
    if (ui.phase === 'menu' || ui.phase === 'loading') {
      this.drawMenuBackdrop();
      return;
    }
    if (ui.phase === 'intro') {
      this.drawIntro(ui);
      return;
    }
    if (!this.round) return;
    this.updateCamera(dtShow);
    this.drawStage();
    this.drawLayers(dtShow, ui.phase === 'fight' || ui.phase === 'countdown');
    this.drawArenaFx();
    this.drawLastSeconds(ui);
    if (this.flash > 0) {
      this.ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.35})`;
      this.ctx.fillRect(OX, OY, FW, FH);
    }
    this.drawHud(ui);
    if (ui.phase === 'countdown') this.drawCountdown(ui);
    if (ui.phase === 'fight' || ui.phase === 'countdown') this.drawAnnouncements();
    if (ui.phase === 'roundEnd' && ui.banner) this.drawRoundEnd(ui);
    if (ui.phase === 'review' && ui.review) this.drawReview(ui);
    if (ui.phase === 'matchEnd') this.drawMatchEnd(ui);
    if (ui.paused) this.drawPause();
  }
}
