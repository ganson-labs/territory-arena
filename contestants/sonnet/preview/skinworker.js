// Запускает bot/skin.js так же, как арена: модульный Worker + OffscreenCanvas.
let skin = null;
let canvas = null;
let ctx = null;
let errors = 0;
let times = [];
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const mod = await import(m.url);
    skin = mod.default;
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'frame') {
    const f = m.f;
    if (!canvas || canvas.width !== f.width || canvas.height !== f.height) {
      canvas = new OffscreenCanvas(f.width, f.height);
      ctx = canvas.getContext('2d');
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const t0 = performance.now();
    try {
      ctx.save();
      skin.draw(ctx, f);
      ctx.restore();
    } catch (err) {
      errors++;
      if (errors < 5) self.postMessage({ type: 'error', msg: String(err && err.stack || err) });
    }
    const dt = performance.now() - t0;
    const bmp = canvas.transferToImageBitmap();
    self.postMessage({ type: 'bitmap', bmp, ms: dt, id: m.id }, [bmp]);
  }
};
