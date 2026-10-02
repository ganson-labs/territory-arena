import * as E from '/kit/arena/engine.js';
import { createRecorder, summarize } from '/kit/arena/report.js';
import { BotHost } from './bot-host.js';
import { ReplayHost } from './replay-host.js';
import { SkinHost } from './skin-host.js';
import { Renderer } from './render.js';
import { Sfx } from './sfx.js';

const $ = (s) => document.querySelector(s);
const R = new Renderer($('#stage'));
const sfx = new Sfx();
const params = new URLSearchParams(location.search);
const ALT_COLOR = '#e0b04a';
const TICK_MS = 1000 / E.TICK_RATE;
// ?slow=0.25 runs the whole show (game, skins, camera) at a quarter of real time: for frame-by-frame recording.
const SLOW = Math.max(0.05, Math.min(1, Number(params.get('slow')) || 1));
// ?replay=<id участника или путь к его папке>: раунды турнира из rounds/round-N.json вместо ботов
// (или replay=url:<адрес файла реплея>).
// &round=2 или 1,3 или 1-3 — какие раунды (по умолчанию все из &rounds=3); после последнего раунда турнира — победитель.
const REPLAY = params.get('replay');
// ?capture=1: покадровая запись. Своего rAF-цикла нет, кадр делает window.__cap.step() ровно на 1/60 с шоу,
// облики получают виртуальное время и засеянный Math.random, звуки пишутся в журнал (window.__cap.sfxLog).
const CAPTURE = params.has('capture');
// ?layers=native: слои команд и окна обликов в полном разрешении холста (запись 4K).
if (params.get('layers') === 'native') {
  R.nativeLayers = true;
  R.resize();
}

const ui = {
  phase: 'menu',
  speed: 1,
  paused: false,
  score: [0, 0],
  roundIndex: 0,
  roundLabel: '',
  firstTo: 2,
  countdown: null,
  banner: null,
  review: null,
  matchEnd: null,
  introStart: 0,
  introNext: 'match',
  debug: false,
  noHint: !!REPLAY, // в реплее пробел никто не жмёт: подсказки «ПРОБЕЛ — В БОЙ» нет
};
let bots = [];
let contestants = null;
let runToken = 0;
let nextRound = null;
let loading = 0; // > 0 while teams load from disk: capture does not step frames then
const sfxLog = [];

// ---------- show clock ----------
// Everything on screen runs on one clock: game ticks, skins, camera, timers.
let show = 0;
const timers = [];
let frameWaiters = [];
const sim = { budget: 0 };
window.__arena = ui;
window.__renderer = R;
window.__show = () => show;
if (CAPTURE) {
  // Sounds are not played but logged with the show time; the capture renders them offline.
  sfx.unlock = () => {};
  sfx.play = (name, x, k) => sfxLog.push({ show, name, x: x ?? null, k: k ?? 0 });
}

function showWait(ms, token) {
  const at = show + ms;
  return new Promise((resolve) => timers.push({ at, resolve: () => resolve(token === runToken) }));
}
const nextFrame = () => new Promise((r) => frameWaiters.push(r));

// ---------- menu ----------

function showMenu(msg = '', isError = false) {
  runToken++;
  disposeAll();
  ui.phase = 'menu';
  ui.paused = false;
  $('#menu').hidden = false;
  $('#btnNext').hidden = true;
  $('#status').textContent = msg;
  $('#status').classList.toggle('error', isError);
}

async function loadBotList() {
  // a / b in the link: a contestant id from arena.config.json or an absolute path to its folder.
  const q = new URLSearchParams();
  for (const k of ['a', 'b']) if (params.get(k) && /^([a-zA-Z]:)?[\\/]/.test(params.get(k))) q.append('path', params.get(k));
  bots = await (await fetch(`/api/bots?${q}`)).json();
  for (const sel of [$('#botA'), $('#botB')]) {
    sel.innerHTML = '';
    for (const b of bots) {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = `${b.model} — ${b.id}`;
      sel.appendChild(o);
    }
  }
  const contest = bots.filter((b) => !b.id.startsWith('sparring/'));
  $('#botA').value = params.get('a') || contest[0]?.id || 'sparring/farmer';
  $('#botB').value = params.get('b') || contest[1]?.id || 'sparring/raider';
  if (params.get('first')) $('#firstTo').value = params.get('first');
  if (params.get('rounds')) $('#tourRounds').value = params.get('rounds');
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

async function readTeam(entry) {
  let team = {};
  try {
    const r = await fetch(`${entry.dir}team.json?v=${Date.now()}`);
    if (r.ok) team = await r.json();
  } catch (err) {
    console.warn(`${entry.id}: team.json не читается`, err);
  }
  return {
    name: String(team.name || entry.id.split('/').pop()).slice(0, 24),
    motto: String(team.motto || '').slice(0, 80),
    color: HEX.test(team.color) ? team.color : entry.color,
    accent: HEX.test(team.accent) ? team.accent : '#ffffff',
  };
}

// Load (or reload from disk) everything about one contestant: team, skin and bot.
async function loadContestant(entry, altColor) {
  const team = await readTeam(entry);
  if (altColor) team.color = altColor;
  const det = CAPTURE ? { seed: hashSeed(`${entry.id}|${team.name}`), clock: () => show } : null;
  const skin = new SkinHost(team, entry.hasSkin ? `${entry.dir}skin.js` : null, entry.assets || [], det);
  await skin.start();
  const host = REPLAY ? new ReplayHost(entry) : new BotHost(entry);
  try {
    await host.load();
  } catch (err) {
    host.dispose();
    skin.dispose();
    throw err;
  }
  return { id: entry.id, entry, host, skin, name: team.name, motto: team.motto, model: entry.model, color: team.color, accent: team.accent, altColor };
}

function disposeAll() {
  for (const c of contestants || []) {
    c.host?.dispose();
    c.skin?.dispose();
  }
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

async function loadPair(entries, prev) {
  loading++;
  try {
    return await loadPairNow(entries, prev);
  } finally {
    loading--;
  }
}

async function loadPairNow(entries, prev) {
  const a = await loadContestant(entries[0], prev?.[0]?.altColor);
  let b = await loadContestant(entries[1], prev?.[1]?.altColor);
  if (a.color.toLowerCase() === b.color.toLowerCase() && !b.altColor) {
    b.skin.dispose();
    b.host.dispose();
    b = await loadContestant(entries[1], ALT_COLOR);
  }
  return [a, b];
}

async function prepare() {
  loading++;
  try {
    await prepareNow();
  } finally {
    loading--;
  }
}

async function prepareNow() {
  sfx.unlock();
  disposeAll();
  ui.phase = 'loading';
  $('#status').textContent = 'Загружаю команды и облики…';
  $('#status').classList.remove('error');
  ui.firstTo = Math.max(1, Math.min(9, Number($('#firstTo').value) || 2));
  const ids = [$('#botA').value, $('#botB').value];
  const entries = ids.map((id) => bots.find((b) => b.id === id));
  if (entries.some((e) => !e)) throw new Error(`Нет такого бота: ${ids.join(', ')}`);
  contestants = await loadPair(entries);
  R.contestants = contestants;
  await document.fonts.load('40px "Russo One"').catch(() => {});
  await document.fonts.load('600 40px "Inter"').catch(() => {});
  $('#menu').hidden = true;
}

async function start(mode) {
  try {
    await prepare();
  } catch (err) {
    console.error(err);
    showMenu(String(err.message || err), true);
    return;
  }
  const token = ++runToken;
  if (mode === 'intro' || mode === 'tournament') {
    ui.phase = 'intro';
    ui.introNext = REPLAY ? 'replay' : mode === 'tournament' ? 'tournament' : 'match';
    ui.introStart = show;
    if (params.get('autostart')) showWait(Number(params.get('autostart')) * 1000, token).then((ok) => ok && ui.phase === 'intro' && launchFromIntro());
    return;
  }
  if (REPLAY) runReplay(token);
  else runMatch(token);
}

function launchFromIntro() {
  const token = ++runToken;
  if (ui.introNext === 'replay') runReplay(token);
  else if (ui.introNext === 'tournament') runTournament(token, Math.max(1, Math.min(9, Number($('#tourRounds').value) || 3)));
  else runMatch(token);
}

// ---------- rounds ----------

async function saveRound(replay, roundNo) {
  const saved = [];
  let error = '';
  for (let side = 0; side < 2; side++) {
    const c = contestants[replay.players[side].ci];
    if (!c.entry.saveable) continue;
    const mine = { ...replay, you: side };
    try {
      const r = await fetch('/api/round', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: c.id, n: roundNo, replay: mine, md: summarize(mine, side) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      saved.push(j.md);
    } catch (err) {
      error = `Не удалось записать раунд для ${c.id}: ${err.message || err}`;
      console.error(error);
    }
  }
  return { saved, error };
}

function tickBots(round, order) {
  return Promise.all(order.map((ci, side) => contestants[ci].host.tick(E.botView(round, side))));
}

// Play one round with the current contestants. Returns null when interrupted.
async function playRound(token, i, roundNo, replay = null) {
  ui.roundIndex = i;
  const plan = E.roundPlan(i);
  let order = plan.swap ? [1, 0] : [0, 1];
  let mapIndex = plan.mapIndex;
  if (replay) {
    // Sides and map exactly as recorded; the contestant of each side is found by id.
    order = replay.players.map((p) => contestants.findIndex((c) => c.id === p.id));
    if (order.some((ci) => ci < 0) || order[0] === order[1]) throw new Error(`в реплее другие участники: ${replay.players.map((p) => p.id).join(', ')}`);
    mapIndex = replay.mapIndex;
    for (const c of contestants) c.host.use(replay);
  }
  const round = E.createRound({ mapIndex, players: order.map((ci) => ({ name: contestants[ci].name })) });
  const rec = createRecorder(round);
  R.newRound(round, order, contestants);
  await Promise.all(order.map((ci, side) => contestants[ci].host.init({ round: i, side, mapName: round.map.name, view: E.botView(round, side) })));
  if (token !== runToken) return null;

  ui.phase = 'countdown';
  ui.countdown = { start: show };
  for (let k = 0; k < 3; k++) {
    sfx.play('beep');
    if (!(await showWait(1000, token))) return null;
  }
  ui.countdown = null;
  ui.phase = 'fight';
  sim.budget = 0;
  sfx.play('go');
  R.shout('ВПЕРЁД!', '#ffffff');

  let lastSecond = -1;
  let actions = await tickBots(round, order);
  while (!round.over) {
    while (sim.budget < TICK_MS) {
      await nextFrame();
      if (token !== runToken) return null;
    }
    sim.budget -= TICK_MS;
    R.beforeStep(round);
    const events = E.stepRound(round, actions);
    rec.step(events);
    R.afterStep(round, events);
    sfx.events(events);
    const left = Math.ceil((E.ROUND_TICKS - round.tick) / E.TICK_RATE);
    if (left <= 10 && left !== lastSecond && left > 0) sfx.play('tick');
    lastSecond = left;
    if (!round.over) actions = await tickBots(round, order);
    if (token !== runToken) return null;
  }
  sfx.play('end');
  const winnerCi = round.winner == null ? null : order[round.winner];
  const health = order.map((ci) => contestants[ci].host.health());
  const rebuilt = rec.finish({
    round: roundNo,
    health,
    players: order.map((ci) => ({ ci, id: contestants[ci].id, model: contestants[ci].model, name: contestants[ci].name })),
  });
  return { round, replay: rebuilt, order, winnerCi, percent: [0, 1].map((ci) => E.percentOf(round, order.indexOf(ci))) };
}

// ---------- replay ----------

function replayUrl(n) {
  // url:<адрес> — свой файл реплея (например, бой спарринг-ботов из песочницы); {n} заменяется номером раунда.
  if (REPLAY.startsWith('url:')) return REPLAY.slice(4).replace('{n}', n);
  if (/^([a-zA-Z]:)?[\\/]/.test(REPLAY)) {
    const entry = bots.find((b) => b.id === REPLAY);
    if (!entry) throw new Error(`нет участника с папкой ${REPLAY}`);
    return `${entry.dir.replace(/bot\/$/, '')}rounds/round-${n}.json`;
  }
  return `/team/${encodeURIComponent(REPLAY)}/rounds/round-${n}.json`;
}

async function fetchReplay(n) {
  const r = await fetch(`${replayUrl(n)}?v=${Date.now()}`);
  if (!r.ok) throw new Error(`реплей раунда ${n} не читается: ${r.status}`);
  return r.json();
}

function parseRounds(spec, n) {
  if (!spec) return Array.from({ length: n }, (_, k) => k + 1);
  const out = [];
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let k = a; k <= (b || a); k++) if (k >= 1 && k <= n && !out.includes(k)) out.push(k);
  }
  return out.sort((x, y) => x - y);
}

// Compare the rebuilt round with the recorded one (result, tallies, events, timeline, moves).
function checkReplay(replay, rebuilt) {
  const fields = ['mapIndex', 'result', 'tallies', 'events', 'timeline', 'moves'];
  const diff = fields.filter((k) => JSON.stringify(replay[k]) !== JSON.stringify(rebuilt[k]));
  return { round: replay.round, ok: diff.length === 0, diff, result: rebuilt.result, events: rebuilt.events.length };
}

// Tournament from the saved replays: the same show as the live tournament, without the pauses for improvements.
// Nothing is written to the contestants' folders.
async function runReplay(token) {
  const n = Math.max(1, Math.min(9, Number(params.get('rounds')) || Number($('#tourRounds').value) || 3));
  const list = parseRounds(params.get('round'), n);
  window.__replayChecks = [];
  ui.score = [0, 0];
  ui.matchEnd = null;
  const totals = [0, 0];
  const replays = new Map();
  loading++;
  try {
    for (let k = 1; k <= Math.max(...list); k++) replays.set(k, await fetchReplay(k));
  } catch (err) {
    showMenu(String(err.message || err), true);
    return;
  } finally {
    loading--;
  }
  const ciOf = (rp, side) => contestants.findIndex((c) => c.id === rp.players[side].id);
  const count = (k) => {
    const rp = replays.get(k);
    if (rp.result.winner != null) ui.score[ciOf(rp, rp.result.winner)]++;
    for (let side = 0; side < 2; side++) totals[ciOf(rp, side)] += rp.result.percent[side];
  };
  for (let j = 0; j < list.length; j++) {
    const no = list[j];
    for (let k = (j ? list[j - 1] : 0) + 1; k < no; k++) count(k); // rounds that are not shown
    if (no > 1) {
      // As in the live tournament: before rounds 2+ both teams (skins) are loaded from disk again.
      try {
        const prev = contestants;
        const fresh = await loadPair(prev.map((c) => c.entry), prev);
        for (const c of prev) {
          c.host.dispose();
          c.skin.dispose();
        }
        contestants = fresh;
        R.contestants = contestants;
      } catch (err) {
        showMenu(String(err.message || err), true);
        return;
      }
      if (token !== runToken) return;
    }
    const replay = replays.get(no);
    ui.roundLabel = `РАУНД ${no} ИЗ ${n}`;
    const res = await playRound(token, no - 1, no, replay);
    if (!res) return;
    const check = checkReplay(replay, res.replay);
    window.__replayChecks.push(check);
    if (!check.ok) console.error(`[replay] раунд ${no} разошёлся с записью: ${check.diff.join(', ')}`);
    else console.log(`[replay] раунд ${no} совпал с записью: ${res.replay.result.percent.join(' : ')}`);
    if (res.winnerCi != null) ui.score[res.winnerCi]++;
    totals[0] += res.percent[0];
    totals[1] += res.percent[1];
    if (!(await showRoundEnd(token, res))) return;
    if (no === n) {
      let winner = ui.score[0] === ui.score[1] ? null : ui.score[0] > ui.score[1] ? 0 : 1;
      if (winner == null && Math.abs(totals[0] - totals[1]) > 1e-9) winner = totals[0] > totals[1] ? 0 : 1;
      finishMatch(winner, true);
      return;
    }
  }
  ui.phase = 'replayEnd'; // last shown round is not the last one of the tournament: the field stays
}

async function showRoundEnd(token, res) {
  ui.phase = 'roundEnd';
  ui.banner = { winner: res.winnerCi, percent: res.percent, start: show };
  if (res.winnerCi != null) sfx.play('win');
  const ok = await showWait(5500, token);
  ui.banner = null;
  return ok;
}

function finishMatch(winner, tournament) {
  ui.phase = 'matchEnd';
  ui.matchEnd = { winner, score: [...ui.score], start: show, tournament };
  sfx.play('win');
  for (const c of contestants) c.host.dispose();
}

async function freshBots() {
  // Fresh workers = fresh module state for every match.
  for (const c of contestants) {
    c.host?.dispose();
    c.host = new BotHost(c.entry);
    await c.host.load();
  }
}

async function runMatch(token) {
  try {
    await freshBots();
  } catch (err) {
    showMenu(String(err.message || err), true);
    return;
  }
  if (token !== runToken) return;
  ui.score = [0, 0];
  ui.matchEnd = null;
  let i = 0;
  while (Math.max(...ui.score) < ui.firstTo) {
    ui.roundLabel = `РАУНД ${i + 1}`;
    const res = await playRound(token, i, i + 1);
    if (!res) return;
    if (res.winnerCi != null) ui.score[res.winnerCi]++;
    res.replay.match = { score: res.order.map((ci) => ui.score[ci]) };
    saveRound(res.replay, i + 1);
    if (!(await showRoundEnd(token, res))) return;
    i++;
  }
  finishMatch(ui.score[0] === ui.score[1] ? null : ui.score[0] > ui.score[1] ? 0 : 1, false);
}

// Tournament with a pause for improvements: after every round the files are written,
// the viewer waits for N, then reloads both teams (bot, team, skin) from disk.
async function runTournament(token, n) {
  try {
    await freshBots();
  } catch (err) {
    showMenu(String(err.message || err), true);
    return;
  }
  // Продолжение турнира после перезагрузки страницы: ?from=2&score=1:0&totals=93.8:1.1
  const from = Math.max(1, Math.min(n, Number(params.get('from')) || 1));
  const pair = (k) => (params.get(k) || '0:0').split(':').map((x) => Number(x) || 0);
  ui.score = from > 1 ? pair('score') : [0, 0];
  ui.matchEnd = null;
  const totals = from > 1 ? pair('totals') : [0, 0];
  for (let i = from - 1; i < n; i++) {
    if (i > from - 1) {
      try {
        const prev = contestants;
        const fresh = await loadPair(prev.map((c) => c.entry), prev);
        for (const c of prev) {
          c.host.dispose();
          c.skin.dispose();
        }
        contestants = fresh;
        R.contestants = contestants;
      } catch (err) {
        ui.review.error = `Не удалось перезагрузить: ${err.message || err}. Исправь и нажми N ещё раз.`;
        ui.phase = 'review';
        $('#btnNext').hidden = false;
        await new Promise((r) => (nextRound = r));
        if (token !== runToken) return;
        i--;
        continue;
      }
      if (token !== runToken) return;
    }
    ui.roundLabel = `РАУНД ${i + 1} ИЗ ${n}`;
    const res = await playRound(token, i, i + 1);
    if (!res) return;
    if (res.winnerCi != null) ui.score[res.winnerCi]++;
    totals[0] += res.percent[0];
    totals[1] += res.percent[1];
    res.replay.match = { score: res.order.map((ci) => ui.score[ci]) };
    const savePromise = saveRound(res.replay, i + 1);
    if (!(await showRoundEnd(token, res))) return;
    const { saved, error } = await savePromise;
    if (i === n - 1) break;
    ui.review = { done: i + 1, total: n, score: [...ui.score], lastPercent: res.percent, saved, error };
    ui.phase = 'review';
    for (const c of contestants) c.host.dispose();
    $('#btnNext').textContent = `Раунд ${i + 2}`;
    $('#btnNext').hidden = false;
    await new Promise((r) => (nextRound = r));
    $('#btnNext').hidden = true;
    if (token !== runToken) return;
  }
  let winner = ui.score[0] === ui.score[1] ? null : ui.score[0] > ui.score[1] ? 0 : 1;
  if (winner == null && Math.abs(totals[0] - totals[1]) > 1e-9) winner = totals[0] > totals[1] ? 0 : 1;
  finishMatch(winner, true);
}

function goNext() {
  sfx.unlock();
  if (ui.phase !== 'review' || !nextRound) return;
  const r = nextRound;
  nextRound = null;
  $('#btnNext').hidden = true;
  r();
}

// ---------- loop & input ----------

let lastReal = performance.now();
function loop(realNow) {
  requestAnimationFrame(loop);
  const dtReal = Math.max(0, Math.min(100, realNow - lastReal));
  lastReal = realNow;
  frameBody(dtReal * SLOW);
}

function frameBody(dtIn) {
  const dtShow = ui.paused ? 0 : dtIn;
  show += dtShow;
  for (let k = timers.length - 1; k >= 0; k--) {
    if (timers[k].at <= show) timers.splice(k, 1)[0].resolve();
  }
  if (ui.phase === 'fight') sim.budget = Math.min(sim.budget + dtShow * ui.speed * R.timeScale(), 400);
  const waiting = frameWaiters;
  frameWaiters = [];
  for (const w of waiting) w();
  try {
    const alpha = ui.phase === 'fight' ? Math.max(0, Math.min(1, sim.budget / TICK_MS)) : 1;
    R.frame(show, dtShow, ui, alpha);
    if (ui.debug && contestants) {
      R.drawDebug(contestants.flatMap((c) => {
        const h = c.host?.health() || {};
        return [
          `${c.name} (${c.id}): ошибок ${h.errors ?? 0}, пропусков ${h.missed ?? 0}${h.frozen ? ', ЗАВИС' : ''}${h.lastError ? ' — ' + h.lastError.slice(0, 70) : ''}`,
          `   облик: ${c.skin.status()}`,
        ];
      }));
    }
  } catch (err) {
    if (!loop.reported) console.error(err);
    loop.reported = true;
    const ctx = R.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#400';
    ctx.fillRect(0, 0, ctx.canvas.width, 150);
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    String(err?.stack || err).split('\n').slice(0, 6).forEach((l, i) => ctx.fillText(l.slice(0, 160), 16, 30 + i * 20));
  }
}
if (!CAPTURE) requestAnimationFrame(loop);
else {
  const macrotask = () => new Promise((r) => setTimeout(r, 0));
  const until = async (fn, ms, what) => {
    const t0 = performance.now();
    while (!fn()) {
      if (performance.now() - t0 > ms) throw new Error(`capture: не дождался ${what} за ${ms} мс`);
      await new Promise((r) => setTimeout(r, 2));
    }
  };
  window.__cap = {
    // One frame of the show, exactly 1/60 s. Waits for loading teams first; after the frame it lets the
    // game logic released by this frame run (microtasks) and waits for every skin worker's picture.
    async step() {
      await until(() => loading === 0 && ui.phase !== 'loading', 60000, 'загрузки команд');
      frameBody(1000 / 60);
      await macrotask();
      await until(() => loading === 0, 60000, 'загрузки команд');
      for (const c of contestants || []) await c.skin.idle(20000);
      return this.state();
    },
    state() {
      const round = R.round;
      return {
        show,
        phase: ui.phase,
        tick: round ? round.tick : null,
        over: round ? round.over : null,
        roundIndex: ui.roundIndex,
        score: [...ui.score],
        timeScale: R.timeScale(),
        cam: { ...R.cam },
        skins: (contestants || []).map((c) => ({ id: c.id, fallback: c.skin.fallback, reason: c.skin.reason, status: c.skin.status() })),
        checks: window.__replayChecks || [],
      };
    },
    get sfxLog() {
      return sfxLog;
    },
    canvas: R.canvas,
  };
}

addEventListener('keydown', (e) => {
  if (e.target.closest?.('#menu') && e.key !== 'Escape') return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    if (ui.phase === 'intro') launchFromIntro();
    else if (ui.phase === 'countdown' || ui.phase === 'fight' || ui.phase === 'roundEnd') ui.paused = !ui.paused;
    else if (ui.phase === 'review') goNext();
    else if (ui.phase === 'matchEnd') showMenu();
  } else if (k === 'escape') showMenu();
  else if (k === 'n' || k === 'т' || k === 'enter') goNext();
  else if (k === '1') ui.speed = 1;
  else if (k === '2') ui.speed = 2;
  else if (k === '3') ui.speed = 4;
  else if (k === '4') ui.speed = 8;
  else if (k === '0') ui.speed = 0.5;
  else if (k === 'm' || k === 'ь') sfx.toggle();
  else if (k === 'd' || k === 'в') ui.debug = !ui.debug;
  else if (k === 'f' || k === 'а') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
});

// Браузер включает звук только после жеста пользователя, а с ?auto= страница стартует сама.
addEventListener('keydown', () => sfx.unlock());
addEventListener('pointerdown', () => sfx.unlock());

$('#btnIntro').onclick = () => start('intro');
$('#btnFight').onclick = () => start('fight');
$('#btnTour').onclick = () => start('tournament');
$('#btnReload').onclick = () => loadBotList();
$('#btnNext').onclick = () => goNext();

loadBotList()
  .then(() => {
    if (params.get('speed')) ui.speed = Number(params.get('speed')) || 1;
    if (params.get('debug')) ui.debug = true;
    if (params.get('auto')) start(params.get('auto'));
  })
  .catch((err) => showMenu(`Не удалось получить список ботов: ${err.message}`, true));
