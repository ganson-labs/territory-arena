// Main-thread side of a team's skin worker. The skin draws its whole team every frame
// on its own layer. Every frame has a budget; a skin that throws, hangs or is too slow
// is replaced by the built-in look and the show goes on.
import { createDefaultSkin } from './default-skin.js';

export const BUDGET_MS = 8; // per frame, measured inside the worker
const SLOW_WINDOW = 60; // frames
const SLOW_LIMIT = 20; // frames over budget within the window -> fallback
const ERROR_LIMIT = 5;
const HANG_MS = 1500;
const LOAD_MS = 5000;

export class SkinHost {
  constructor(team, url) {
    this.team = team; // { name, motto, color, accent }
    this.url = url;
    this.worker = null;
    this.fallback = !url;
    this.reason = url ? '' : 'нет skin.js';
    this.def = createDefaultSkin();
    this.defCanvas = {};
    this.latest = {}; // mode -> bitmap
    this.retired = [];
    this.pendingEvents = [];
    this.busy = false;
    this.busySince = 0;
    this.slow = [];
    this.errors = 0;
    this.lastError = '';
    this.seq = 0;
    this.frames = 0;
    this.maxMs = 0;
  }

  async start() {
    if (this.fallback) return false;
    this.worker = new Worker(new URL('./skin-worker.js', import.meta.url), { type: 'module' });
    const loaded = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), LOAD_MS);
      this.worker.onmessage = (e) => {
        if (e.data.type === 'loaded') {
          clearTimeout(timer);
          resolve(e.data);
        } else this.onFrame(e.data);
      };
    });
    this.worker.onerror = (e) => {
      this.lastError = e.message;
    };
    this.worker.postMessage({ type: 'load', url: `${location.origin}${this.url}?v=${Date.now()}` });
    const r = await loaded;
    if (!r || r.error || !r.hasDraw) {
      this.giveUp(!r ? 'skin.js не загрузился за 5 с' : r.error ? `skin.js не загрузился: ${r.error.split('\n')[0]}` : 'в skin.js нет функции draw');
      return false;
    }
    this.worker.onmessage = (e) => this.onFrame(e.data);
    return true;
  }

  giveUp(reason) {
    if (this.fallback) return;
    this.fallback = true;
    this.reason = reason;
    console.warn(`[skin ${this.team.name}] облик по умолчанию: ${reason}`);
    this.worker?.terminate();
    this.worker = null;
    // Bitmaps of a terminated worker must never be drawn again.
    for (const b of Object.values(this.latest)) b?.close?.();
    this.latest = {};
    for (const r of this.retired) r.b.close?.();
    this.retired = [];
    this.busy = false;
  }

  onFrame(m) {
    if (m.type !== 'frame' || this.fallback) {
      m.bitmap?.close?.();
      return;
    }
    this.busy = false;
    this.frames++;
    this.maxMs = Math.max(this.maxMs, m.ms);
    this.slow.push(m.ms > BUDGET_MS ? 1 : 0);
    if (this.slow.length > SLOW_WINDOW) this.slow.shift();
    if (m.error) {
      this.errors++;
      this.lastError = m.error.split('\n')[0];
      m.bitmap.close();
      if (this.errors >= ERROR_LIMIT) this.giveUp(`ошибки в draw: ${this.lastError}`);
      return;
    }
    if (this.slow.reduce((a, b) => a + b, 0) > SLOW_LIMIT) {
      m.bitmap.close();
      this.giveUp(`медленно: больше ${BUDGET_MS} мс на кадр`);
      return;
    }
    const old = this.latest[m.mode];
    if (old) this.retired.push({ b: old, at: this.seq });
    this.latest[m.mode] = m.bitmap;
  }

  // Called once per displayed frame. Returns an image to draw for this mode (or null).
  frame(f) {
    this.seq++;
    // Retire old bitmaps a few frames later, after the page has surely drawn them.
    while (this.retired.length && this.seq - this.retired[0].at > 3) this.retired.shift().b.close();
    const events = this.pendingEvents.concat(f.events || []);
    this.pendingEvents = [];
    if (!this.fallback && this.busy && performance.now() - this.busySince > HANG_MS) this.giveUp('завис: нет ответа 1,5 с');
    if (this.fallback) return this.drawDefault({ ...f, events });
    if (this.busy) {
      this.pendingEvents = events;
      return this.latest[f.mode] || null;
    }
    this.busy = true;
    this.busySince = performance.now();
    this.worker.postMessage({ type: 'frame', id: this.seq, f: { ...f, events } });
    return this.latest[f.mode] || null;
  }

  // Last image of a mode without asking for a new one (frozen field under the winner screen).
  peek(mode) {
    return this.fallback ? this.defCanvas[mode] || null : this.latest[mode] || null;
  }

  drawDefault(f) {
    let c = this.defCanvas[f.mode];
    if (!c || c.width !== f.width || c.height !== f.height) c = this.defCanvas[f.mode] = new OffscreenCanvas(f.width, f.height);
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, c.width, c.height);
    try {
      ctx.save();
      this.def.draw(ctx, f);
      ctx.restore();
    } catch (err) {
      console.error('default skin', err);
    }
    return c;
  }

  status() {
    if (this.fallback) return `по умолчанию (${this.reason})`;
    const slow = this.slow.reduce((a, b) => a + b, 0);
    return `облик команды: кадров ${this.frames}, макс ${this.maxMs.toFixed(1)} мс, медленных ${slow}/${this.slow.length}, ошибок ${this.errors}`;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const b of Object.values(this.latest)) b?.close?.();
    this.latest = {};
  }
}
