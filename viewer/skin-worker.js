// Runs one team's skin.js in isolation: it only ever sees its own blank OffscreenCanvas and frame data.
let skin = null;
const canvases = {};
const describe = (err) => String((err && err.stack) || err).split('\n').slice(0, 3).join('\n');

self.onmessage = async ({ data: m }) => {
  if (m.type === 'load') {
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
    let error = null;
    try {
      ctx.save();
      skin.draw(ctx, f);
      ctx.restore();
    } catch (err) {
      error = describe(err);
    }
    const ms = performance.now() - t0;
    const bitmap = c.transferToImageBitmap();
    self.postMessage({ id: m.id, type: 'frame', mode: f.mode, bitmap, ms, error }, [bitmap]);
  }
};
