// Main-thread side of a skin worker. Every skin call has a deadline; anything
// that fails, throws or hangs is replaced by the built-in look and the show goes on.
import { defaultSkin } from './default-skin.js';

export const HEAD_FRAMES = 8;
export const DIRS = ['up', 'down', 'left', 'right'];
export const HEAD_PX = 192;
export const PORTRAIT_PX = 640;
export const TILE_PX = 256;
const FIRST_MS = 2000;
const CALL_MS = 400;
const PREP_BUDGET_MS = 8000;
const VICTORY_MS = 300;

function drawDefault(what, w, h, args) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  try {
    defaultSkin[what](ctx, args);
  } catch (err) {
    console.error('default skin', what, err);
  }
  return c.transferToImageBitmap();
}

// Copy a bitmap that came from the skin worker into a canvas owned by the page:
// bitmaps from a worker that is later terminated (hung skin) can no longer be drawn.
function own(bitmap, w, h) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  ctx.getImageData(0, 0, 1, 1); // force the copy to happen now, before the bitmap is closed
  bitmap.close();
  return c;
}

export class SkinHost {
  constructor(team, url) {
    this.team = team; // { name, color, accent }
    this.url = url; // null -> built-in look
    this.worker = null;
    this.has = null;
    this.seq = 0;
    this.pending = new Map();
    this.status = {}; // what -> 'облик команды' | 'по умолчанию'
    this.errors = [];
    this.art = null;
    this.victory = null;
  }

  colors() {
    return { color: this.team.color, accent: this.team.accent, name: this.team.name };
  }

  async start() {
    this.stop();
    if (!this.url) return false;
    this.worker = new Worker(new URL('./skin-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const cb = this.pending.get(e.data.id);
      if (cb) {
        this.pending.delete(e.data.id);
        cb(e.data);
      }
    };
    this.worker.onerror = (e) => this.note(`ошибка воркера: ${e.message}`);
    const r = await this.request({ type: 'load', url: `${location.origin}${this.url}?v=${Date.now()}` }, 5000);
    if (!r || r.error) {
      this.note(r ? `skin.js не загрузился: ${r.error}` : 'skin.js не загрузился за 5 с');
      this.stop();
      return false;
    }
    this.has = r.has;
    return true;
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    const cbs = [...this.pending.values()];
    this.pending.clear();
    for (const cb of cbs) cb(undefined);
  }

  note(msg) {
    if (this.errors.length < 20) this.errors.push(msg);
    console.warn(`[skin ${this.team.name}] ${msg}`);
  }

  request(msg, timeout) {
    if (!this.worker) return Promise.resolve(undefined);
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(undefined);
      }, timeout);
      this.pending.set(id, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      this.worker.postMessage({ ...msg, id });
    });
  }

  // One skin call -> bitmap, or null when the skin failed (the caller then uses the default).
  async call(what, w, h, args, timeout) {
    if (!this.worker || !this.has?.[what]) return null;
    const r = await this.request({ type: 'render', what, w, h, args }, timeout);
    if (r === undefined) {
      this.note(`${what}: нет ответа за ${timeout} мс, облик отключён`);
      this.stop();
      return null;
    }
    if (r.error) {
      this.note(`${what}: ${r.error.split('\n')[0]}`);
      return null;
    }
    return own(r.bitmap, w, h);
  }

  // Pre-render everything the field needs. Never throws, never takes much longer than the budget.
  async prepare() {
    const t0 = performance.now();
    await this.start();
    const c = this.colors();
    let first = true;
    const get = async (what, w, h, args) => {
      let bmp = null;
      if (this.worker && performance.now() - t0 < PREP_BUDGET_MS) {
        bmp = await this.call(what, w, h, { ...c, ...args }, first ? FIRST_MS : CALL_MS);
        first = false;
      }
      if (bmp) {
        if (this.status[what] !== 'по умолчанию') this.status[what] = 'облик команды';
        return bmp;
      }
      this.status[what] = 'по умолчанию';
      return drawDefault(what, w, h, { ...c, ...args });
    };
    const art = { heads: {}, portrait: [] };
    for (const dir of DIRS) {
      art.heads[dir] = [];
      for (let f = 0; f < HEAD_FRAMES; f++) art.heads[dir].push(await get('head', HEAD_PX, HEAD_PX, { size: HEAD_PX, dir, frame: f, frames: HEAD_FRAMES }));
    }
    for (let f = 0; f < HEAD_FRAMES; f++) {
      art.portrait.push(await get('head', PORTRAIT_PX, PORTRAIT_PX, { size: PORTRAIT_PX, dir: 'down', frame: f, frames: HEAD_FRAMES }));
    }
    art.land = await get('land', TILE_PX, TILE_PX, { size: TILE_PX });
    art.trail = await get('trail', TILE_PX, TILE_PX, { size: TILE_PX });
    this.art = art;
    return art;
  }

  // ---------- victory animation, streamed frame by frame ----------

  async startVictory(w, h, duration) {
    this.stopVictory();
    const v = { w, h, duration, start: performance.now(), bitmap: null, fallback: false, active: true, scratch: null };
    this.victory = v;
    if (!this.url || (this.has && !this.has.victory)) {
      v.fallback = true;
      return;
    }
    if (!this.worker && !(await this.start())) {
      v.fallback = true;
      return;
    }
    if (!this.has?.victory) {
      v.fallback = true;
      return;
    }
    const c = this.colors();
    while (v.active && this.victory === v) {
      const t = Math.min(duration, (performance.now() - v.start) / 1000);
      const bmp = await this.call('victory', w, h, { ...c, width: w, height: h, t, duration }, VICTORY_MS);
      if (!v.active) {
        // frame no longer needed
        break;
      }
      if (!bmp) {
        v.fallback = true;
        this.status.victory = 'по умолчанию';
        break;
      }
      this.status.victory = 'облик команды';

      v.bitmap = bmp;
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  stopVictory() {
    if (this.victory) {
      this.victory.active = false;

      this.victory = null;
    }
  }

  // Draw the current victory frame into the box (x, y, w, h) of a 2D context.
  drawVictory(ctx, x, y, w, h) {
    const v = this.victory;
    if (!v) return;
    if (!v.fallback && v.bitmap) {
      ctx.drawImage(v.bitmap, x, y, w, h);
      return;
    }
    if (!v.fallback && performance.now() - v.start < 400) return; // first frame is on its way
    if (!v.scratch) v.scratch = new OffscreenCanvas(v.w, v.h);
    const sctx = v.scratch.getContext('2d');
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    sctx.clearRect(0, 0, v.w, v.h);
    const t = Math.min(v.duration, (performance.now() - v.start) / 1000);
    try {
      defaultSkin.victory(sctx, { ...this.colors(), width: v.w, height: v.h, t, duration: v.duration });
    } catch (err) {
      console.error(err);
    }
    ctx.drawImage(v.scratch, x, y, w, h);
  }

  dispose() {
    this.stopVictory();
    this.stop();
  }
}
