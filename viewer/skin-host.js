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

const SVG_LONG_SIDE = 1280;
const IMAGES_MS = 8000;

// Rasterise the team's pictures on the page. A picture that fails is skipped, never fatal.
async function loadImages(assets, errors) {
  const out = {};
  const one = async (a) => {
    try {
      const r = await fetch(`${a.url}?v=${Date.now()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      if (a.name.toLowerCase().endsWith('.svg')) {
        const text = await blob.text();
        // Size from width/height, else from viewBox: an SVG without them has no natural size.
        const num = (re) => Number((text.match(re) || [])[1]);
        const vb = (text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i) || []).slice(1).map(Number);
        let w = num(/<svg[^>]*\swidth\s*=\s*["']?([\d.]+)/i) || vb[0] || 512;
        let h = num(/<svg[^>]*\sheight\s*=\s*["']?([\d.]+)/i) || vb[1] || w;
        const k = SVG_LONG_SIDE / Math.max(w, h);
        w = Math.max(1, Math.round(w * k));
        h = Math.max(1, Math.round(h * k));
        const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
        try {
          const img = new Image(w, h);
          img.src = url;
          await img.decode();
          const c = new OffscreenCanvas(w, h);
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          out[a.name] = c.transferToImageBitmap();
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        out[a.name] = await createImageBitmap(blob);
      }
    } catch (err) {
      errors.push(`${a.name}: ${err?.message || err}`);
      console.warn(`[skin] картинка ${a.name} не загрузилась:`, err);
    }
  };
  await Promise.race([Promise.all(assets.map(one)), new Promise((r) => setTimeout(r, IMAGES_MS))]);
  return out;
}

export class SkinHost {
  // det (capture only): { seed, clock: () => show ms }. The worker then runs on that virtual clock with a
  // seeded Math.random, and the 8 ms budget is not enforced (frames are not real time); the real drawing
  // time is still measured and shown in status().
  constructor(team, url, assets = [], det = null) {
    this.det = det;
    this.realMs = { max: 0, sum: 0, n: 0, over: 0 };
    this.team = team; // { name, motto, color, accent }
    this.url = url;
    this.assets = assets; // [{ name, url }]
    this.imageErrors = [];
    this.imageCount = 0;
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
    // Pictures go first, so the very first draw already has them.
    const images = await loadImages(this.assets, this.imageErrors);
    this.imageCount = Object.keys(images).length;
    this.worker.postMessage({ type: 'images', images }, Object.values(images));
    this.worker.postMessage({ type: 'load', url: `${location.origin}${this.url}?v=${Date.now()}`, det: this.det ? { seed: this.det.seed, now: this.det.clock() } : null });
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
    this.wake?.();
    this.frames++;
    this.maxMs = Math.max(this.maxMs, m.ms);
    if (m.realMs != null) {
      const r = this.realMs;
      r.max = Math.max(r.max, m.realMs);
      r.sum += m.realMs;
      r.n++;
      if (m.realMs > BUDGET_MS) r.over++;
    }
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
    this.worker.postMessage({ type: 'frame', id: this.seq, f: { ...f, events }, now: this.det ? this.det.clock() : undefined });
    return this.latest[f.mode] || null;
  }

  // Capture: resolves when the worker has answered the last frame (or the skin fell back).
  idle(ms = 20000) {
    if (!this.busy || this.fallback) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        this.giveUp(`завис: нет ответа ${ms / 1000} с (запись)`);
        resolve(false);
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve(true);
      };
    });
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
    const img = this.assets.length ? `, картинок ${this.imageCount}/${this.assets.length}${this.imageErrors.length ? ` (сбой: ${this.imageErrors[0].slice(0, 50)})` : ''}` : '';
    if (this.fallback) return `по умолчанию (${this.reason})${img}`;
    const slow = this.slow.reduce((a, b) => a + b, 0);
    const r = this.realMs;
    const real = this.det && r.n ? `; реально в среднем ${(r.sum / r.n).toFixed(1)} мс, макс ${r.max.toFixed(1)} мс, дольше ${BUDGET_MS} мс: ${r.over}/${r.n}` : '';
    return `облик команды: кадров ${this.frames}, макс ${this.maxMs.toFixed(1)} мс, медленных ${slow}/${this.slow.length}, ошибок ${this.errors}${img}${real}`;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const b of Object.values(this.latest)) b?.close?.();
    this.latest = {};
  }
}
