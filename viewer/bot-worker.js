// Runs one bot in isolation. The bot never sees engine state, the skin or the other bot.
let bot = null;

const describe = (err) => String((err && err.stack) || err);

self.onmessage = async ({ data: m }) => {
  if (m.type === 'load') {
    try {
      const mod = await import(m.url);
      bot = mod.default ?? mod;
      self.postMessage({ id: m.id, type: 'loaded', hasTick: typeof bot?.tick === 'function' });
    } catch (err) {
      self.postMessage({ id: m.id, type: 'loaded', error: describe(err) });
    }
    return;
  }
  if (m.type === 'init') {
    try {
      bot?.init?.(m.info);
    } catch (err) {
      self.postMessage({ type: 'error', where: 'init', error: describe(err) });
    }
    self.postMessage({ id: m.id, type: 'ok' });
    return;
  }
  if (m.type === 'tick') {
    let action = null;
    const t0 = performance.now();
    try {
      action = bot.tick(m.view);
    } catch (err) {
      self.postMessage({ type: 'error', where: 'tick', error: describe(err) });
    }
    if (action && typeof action === 'object') action = action.dir ?? action.direction ?? null;
    const ms = performance.now() - t0;
    self.postMessage({ id: m.id, type: 'action', ms, action: typeof action === 'string' ? action.slice(0, 16) : null });
  }
};
