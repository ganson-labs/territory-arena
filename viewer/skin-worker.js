// Runs one team's skin.js in isolation: it only ever sees its own blank OffscreenCanvas and frame data.
let skin = null;
let images = {};
const canvases = {};
const realNow = performance.now.bind(performance);
let det = null; // capture: { now } — virtual clock of the show, set before every frame

// Capture only: the skin sees the show's virtual clock (performance.now, Date, requestAnimationFrame)
// and a seeded Math.random, so the same frames always give the same pictures.
function deterministic(seed, now) {
  det = { now };
  let s = seed >>> 0 || 1;
  Math.random = function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(performance, 'now', { value: () => det.now, configurable: true, writable: true });
  const RealDate = Date;
  const BASE = 1790000000000;
  class VDate extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(BASE + det.now);
    }
    static now() {
      return BASE + det.now;
    }
  }
  self.Date = VDate;
  // A skin's own animation loop would run on real time: its callbacks run before the next frame instead.
  let raf = [];
  self.requestAnimationFrame = (cb) => raf.push(cb);
  self.cancelAnimationFrame = () => {};
  det.flush = () => {
    const q = raf;
    raf = [];
    for (const cb of q) cb(det.now);
  };
}
const describe = (err) => String((err && err.stack) || err).split('\n').slice(0, 3).join('\n');

self.onmessage = async ({ data: m }) => {
  if (m.type === 'images') {
    images = m.images || {};
    return;
  }
  if (m.type === 'load') {
    if (m.det) deterministic(m.det.seed, m.det.now);
    try {
      const mod = await import(m.url);
      skin = mod.default ?? mod;
      self.postMessage({ id: m.id, type: 'loaded', hasDraw: typeof skin?.draw === 'function' });
    } catch (err) {
      self.postMessage({ id: m.id, type: 'loaded', error: describe(err) });
    }
    return;
  }
  if (m.type === 'frame') {
    const f = m.f;
    f.images = images;
    if (det && m.now != null) {
      det.now = m.now;
      try {
        det.flush();
      } catch (err) {
        console.error(err);
      }
    }
    let c = canvases[f.mode];
    if (!c || c.width !== f.width || c.height !== f.height) c = canvases[f.mode] = new OffscreenCanvas(f.width, f.height);
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowBlur = 0;
    ctx.clearRect(0, 0, c.width, c.height);
    const t0 = performance.now();
    const r0 = realNow();
    let error = null;
    try {
      ctx.save();
      skin.draw(ctx, f);
      ctx.restore();
    } catch (err) {
      error = describe(err);
    }
    const ms = performance.now() - t0;
    const realMs = det ? realNow() - r0 : null;
    const bitmap = c.transferToImageBitmap();
    self.postMessage({ id: m.id, type: 'frame', mode: f.mode, bitmap, ms, realMs, error }, [bitmap]);
  }
};
