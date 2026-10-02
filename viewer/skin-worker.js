// Runs one team's skin.js in isolation: it only ever sees a blank OffscreenCanvas.
let skin = null;
const describe = (err) => String((err && err.stack) || err).split('\n').slice(0, 3).join('\n');

self.onmessage = async ({ data: m }) => {
  if (m.type === 'load') {
    try {
      const mod = await import(m.url);
      skin = mod.default ?? mod;
      const has = {};
      for (const k of ['head', 'land', 'trail', 'victory']) has[k] = typeof skin?.[k] === 'function';
      self.postMessage({ id: m.id, type: 'loaded', has });
    } catch (err) {
      self.postMessage({ id: m.id, type: 'loaded', error: describe(err) });
    }
    return;
  }
  if (m.type === 'render') {
    try {
      const fn = skin?.[m.what];
      if (typeof fn !== 'function') throw new Error(`нет функции ${m.what}`);
      const canvas = new OffscreenCanvas(m.w, m.h);
      const ctx = canvas.getContext('2d');
      fn.call(skin, ctx, { ...m.args });
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ id: m.id, type: 'frame', bitmap }, [bitmap]);
    } catch (err) {
      self.postMessage({ id: m.id, type: 'frame', error: describe(err) });
    }
  }
};
