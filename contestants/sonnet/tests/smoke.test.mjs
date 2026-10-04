// Быстрая проверка команды: node --test tests/smoke.test.mjs
// 1) бот играет раунд против «Пахаря» без ошибок, укладывается в лимит хода и набирает землю;
// 2) облик рисует все режимы и события на ненастоящем холсте, строгий режим не должен ловить исключений.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRound, stepRound, botView, percentOf } from '../arena/engine.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = async (rel) => (await import(pathToFileURL(resolve(root, rel)).href)).default;

test('бот играет раунд против Пахаря', async () => {
  const me = await load('bot/bot.js');
  const foe = await load('arena/sparring/farmer/bot.js');
  for (const side of [0, 1]) {
    const round = createRound({ mapIndex: 1 });
    const bots = side === 0 ? [me, foe] : [foe, me];
    bots.forEach((b, s) => b.init?.({ round: 0, side: s, mapName: round.map.name, view: botView(round, s) }));
    let worst = 0;
    while (!round.over && round.tick < 1500) {
      const acts = bots.map((b, s) => {
        const t0 = performance.now();
        const a = b.tick(botView(round, s));
        if (b === me) worst = Math.max(worst, performance.now() - t0);
        return a;
      });
      stepRound(round, acts);
    }
    assert.ok(worst < 50, `ход дольше лимита: ${worst.toFixed(1)} мс`);
    assert.ok(percentOf(round, side) > 10, `мало земли: ${percentOf(round, side).toFixed(1)}%`);
    assert.ok(percentOf(round, side) > percentOf(round, 1 - side), 'Пахарь не должен вести');
  }
});

// Ненастоящий 2D-контекст: принимает любые вызовы и присваивания.
function fakeCtx() {
  const grad = { addColorStop() {} };
  const target = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
    measureText: (s) => ({ width: String(s).length * 12 }),
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

test('облик рисует арену, карточку и победу без исключений', async () => {
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return fakeCtx(); }
  };
  globalThis.__SKIN_STRICT = true;
  const skin = await load('bot/skin.js');
  const team = JSON.parse((await import('node:fs')).readFileSync(resolve(root, 'bot/team.json'), 'utf8'));
  assert.ok(team.name.length <= 24 && team.motto.length <= 80, 'имя до 24 символов, девиз до 80');
  const ring = (x, y, r) => Float32Array.from([x - r, y - r, x + r, y - r, x + r, y + r, x - r, y + r]);
  const base = { color: team.color, accent: team.accent, name: team.name, motto: team.motto };
  const ctx = fakeCtx();
  for (let i = 0; i < 90; i++) {
    const events = [];
    if (i === 10) events.push({ type: 'capture', x: 300, y: 300, percent: 12, cells: 400, area: [ring(300, 300, 80)] });
    if (i === 20) events.push({ type: 'kill', x: 500, y: 400, cause: 'cut' });
    if (i === 30) events.push({ type: 'death', x: 500, y: 400, cause: 'cut' });
    if (i === 70) events.push({ type: 'respawn', x: 240, y: 240 });
    const alive = i < 31 || i >= 70;
    skin.draw(ctx, {
      ...base, mode: 'arena', t: i / 60, dt: 1 / 60, width: 1600, height: 1000, unit: 1,
      land: [ring(240, 240, 120)], base: { x: 240, y: 240, r: 60 },
      trail: Float32Array.from([360, 240, 420, 260, 470, 300]),
      head: { x: 470, y: 300, heading: 40, speed: 200, alive, respawnIn: alive ? 0 : 40, home: false },
      percent: 10, enemyPercent: 8, timeLeft: 90,
      enemy: { head: { x: 600, y: 320, heading: 200, alive: true }, color: '#ff5a6e' }, events,
    });
  }
  for (const t of [0, 0.5, 1.5, 3, 5]) {
    skin.draw(ctx, { ...base, mode: 'intro', t, dt: 1 / 60, width: 840, height: 860 });
    skin.draw(ctx, { ...base, mode: 'intro', t, dt: 1 / 60, width: 1680, height: 1720 });
    skin.draw(ctx, { ...base, mode: 'victory', t, dt: 1 / 60, width: 1152, height: 648, percent: 61.4 });
  }
});
