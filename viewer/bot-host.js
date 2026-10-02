// Main-thread side of a bot worker: request/response with timeouts.
export const TICK_TIMEOUT_MS = 50;
// The 50 ms limit is measured inside the worker, so a busy page (4K rendering)
// never costs a bot its turn. The page itself waits a little longer for the answer.
const WAIT_MS = 300;
// Warm-up: during the first 2 seconds of a round (JIT, first allocations) a move may take up to 250 ms.
const WARMUP_TICKS = 40;
const WARMUP_MS = 250;
// A bot is considered hung only after this much real time without any answer.
const FREEZE_MS = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BotHost {
  constructor(entry) {
    this.entry = entry;
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
    this.busy = false;
    this.busySince = 0;
    this.idle = Promise.resolve();
    this.markIdle = null;
    this.frozen = false;
    this.errors = 0;
    this.missed = 0;
    this.misses = [];
    this.lastError = '';
  }

  async load() {
    this.worker = new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      this.errors++;
      this.lastError = e.message;
    };
    const url = `${location.origin}${this.entry.dir}bot.js?v=${Date.now()}`;
    const info = await this.request({ type: 'load', url }, 15000);
    if (!info) throw new Error(`${this.entry.id}: бот не загрузился за 15 с`);
    if (info.error) throw new Error(`${this.entry.id}: ${info.error}`);
    if (!info.hasTick) throw new Error(`${this.entry.id}: нет функции tick`);
    return info;
  }

  request(msg, timeout) {
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

  work(msg, timeout) {
    this.busy = true;
    this.busySince = performance.now();
    this.idle = new Promise((r) => (this.markIdle = r));
    return this.request(msg, timeout);
  }

  onMessage(m) {
    if (m.type === 'error') {
      this.errors++;
      this.lastError = m.error;
      if (this.errors <= 3) console.warn(`[${this.entry.id}] ${m.where}:`, m.error);
      return;
    }
    if (m.type === 'action' || m.type === 'ok') {
      this.busy = false;
      this.markIdle?.();
    }
    const cb = this.pending.get(m.id);
    if (cb) {
      this.pending.delete(m.id);
      cb(m);
    }
  }

  async init(info) {
    if (this.frozen) return;
    if (this.busy) await Promise.race([this.idle, sleep(2000)]);
    if (this.busy) return this.checkFrozen();
    await this.work({ type: 'init', info }, 2000);
  }

  // Returns the bot's direction, or null (= straight) if it is late, broken or frozen.
  async tick(view) {
    if (this.frozen) return null;
    if (this.busy) await Promise.race([this.idle, sleep(TICK_TIMEOUT_MS)]);
    if (this.busy) {
      this.missed++;
      this.checkFrozen();
      return null;
    }
    const warm = view.tick < WARMUP_TICKS;
    const r = await this.work({ type: 'tick', view }, warm ? WARMUP_MS + 50 : WAIT_MS);
    if (r === undefined || r.ms > (warm ? WARMUP_MS : TICK_TIMEOUT_MS)) {
      this.missed++;
      if (this.misses.length < 20) this.misses.push({ tick: view.tick, ms: r === undefined ? null : Math.round(r.ms) });
      return null;
    }
    return r.action;
  }

  checkFrozen() {
    if (this.busy && performance.now() - this.busySince > FREEZE_MS) {
      this.frozen = true;
      this.lastError = 'бот не отвечал 3 с и отключён';
      this.worker.terminate();
    }
  }

  health() {
    return { missed: this.missed, misses: this.misses, errors: this.errors, frozen: this.frozen, lastError: String(this.lastError || '').split('\n')[0].slice(0, 200) };
  }

  dispose() {
    this.worker?.terminate();
    this.pending.clear();
  }
}
