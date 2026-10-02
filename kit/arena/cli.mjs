#!/usr/bin/env node
// Песочница: твой бот против спарринг-ботов без браузера.
//   node arena/cli.mjs                       -> bot/ против Охотника, 6 раундов: все карты с обеих сторон
//   node arena/cli.mjs --vs farmer --rounds 3
//   node arena/cli.mjs --vs bot              -> зеркальный матч против самого себя
//   node arena/cli.mjs --map Фланги --verbose
//   node arena/cli.mjs --save sandbox-rounds -> записать реплеи и сводки каждого раунда
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { MAPS, createRound, stepRound, botView, roundPlan, percentOf, TICK_RATE } from './engine.js';
import { createRecorder, summarize, clock } from './report.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function parseArgs(argv) {
  const opts = { bot: 'bot', vs: 'raider', rounds: 6, map: null, verbose: false, save: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vs') opts.vs = argv[++i];
    else if (a === '--rounds') opts.rounds = Number(argv[++i]);
    else if (a === '--map') opts.map = argv[++i];
    else if (a === '--save') opts.save = argv[++i];
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else rest.push(a);
  }
  if (rest[0]) opts.bot = rest[0];
  return opts;
}

function resolveBotDir(spec) {
  const candidates = [resolve(process.cwd(), spec), resolve(root, spec), join(here, 'sparring', spec)];
  for (const c of candidates) if (existsSync(join(c, 'bot.js'))) return c;
  throw new Error(`Не нашёл bot.js для «${spec}». Искал: ${candidates.join(', ')}`);
}

function readTeam(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'team.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function loadBot(dir, instance) {
  // Параметр в адресе даёт каждой стороне свой экземпляр модуля (зеркальный матч).
  const url = pathToFileURL(join(dir, 'bot.js')).href + `?instance=${instance}`;
  const mod = await import(url);
  const bot = mod.default ?? mod;
  if (!bot || typeof bot.tick !== 'function') throw new Error(`${dir}/bot.js: нет export default { tick(state) { ... } }`);
  const team = readTeam(dir);
  return { bot, dir, name: String(team.name || bot.name || 'Без имени').slice(0, 24), errors: 0, timeMax: 0, timeSum: 0, calls: 0, slow: 0 };
}

function callBot(entry, fn, arg) {
  const t0 = performance.now();
  try {
    return entry.bot[fn]?.(arg);
  } catch (err) {
    entry.errors++;
    if (entry.errors <= 3) console.error(`  ! ${entry.name}.${fn} бросил ошибку: ${err?.stack || err}`);
    return null;
  } finally {
    const dt = performance.now() - t0;
    if (fn === 'tick') {
      entry.timeMax = Math.max(entry.timeMax, dt);
      entry.timeSum += dt;
      entry.calls++;
      if (dt > 50) entry.slow++;
    }
  }
}

const CAUSE = { cut: 'срезан', self: 'свой хвост', wall: 'край поля', head: 'лоб в лоб', land: 'обвели всю землю' };

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('node arena/cli.mjs [папка-бота=bot] [--vs raider|farmer|bot|путь] [--rounds 6] [--map имя] [--verbose] [--save папка]');
    return;
  }
  const me = await loadBot(resolveBotDir(opts.bot), 0);
  const foe = await loadBot(resolveBotDir(opts.vs), 1);
  const mapFilter = opts.map
    ? MAPS.findIndex((m, i) => m.name.toLowerCase() === opts.map.toLowerCase() || String(i) === opts.map)
    : -1;
  if (opts.map && mapFilter < 0) throw new Error(`Нет карты «${opts.map}». Есть: ${MAPS.map((m) => m.name).join(', ')}`);
  if (opts.save) mkdirSync(resolve(process.cwd(), opts.save), { recursive: true });

  console.log(`\n${me.name}  vs  ${foe.name}   (${opts.rounds} раундов)\n`);
  const score = { win: 0, loss: 0, draw: 0 };
  const sum = { mine: 0, theirs: 0, kills: 0, deaths: 0 };

  for (let i = 0; i < opts.rounds; i++) {
    const plan = roundPlan(i);
    const mapIndex = mapFilter >= 0 ? mapFilter : plan.mapIndex;
    const mySide = plan.swap ? 1 : 0;
    const bySide = mySide === 0 ? [me, foe] : [foe, me];
    const round = createRound({ mapIndex, players: bySide.map((e) => ({ name: e.name })) });
    const rec = createRecorder(round);
    for (let s = 0; s < 2; s++) {
      callBot(bySide[s], 'init', { round: i, side: s, mapName: round.map.name, view: botView(round, s) });
    }
    while (!round.over) {
      const actions = [0, 1].map((s) => callBot(bySide[s], 'tick', botView(round, s)));
      const events = stepRound(round, actions);
      rec.step(events);
      if (opts.verbose) {
        for (const e of events) {
          const who = bySide[e.side]?.name;
          if (e.type === 'death') console.log(`  ${clock(round.tick)}  ${who} погиб: ${CAUSE[e.cause]}, хвост ${e.trailLength}, сгорело ${e.lostCells} клеток`);
          if (e.type === 'capture' && e.count >= 20) console.log(`  ${clock(round.tick)}  ${who} захватил ${e.count} клеток${e.stolen ? ` (из них у соперника ${e.stolen})` : ''}`);
        }
      }
    }
    const pm = percentOf(round, mySide);
    const pt = percentOf(round, 1 - mySide);
    let result;
    if (round.winner === null) { result = 'НИЧЬЯ '; score.draw++; }
    else if (round.winner === mySide) { result = 'ПОБЕДА'; score.win++; }
    else { result = 'ПОРАЖ.'; score.loss++; }
    sum.mine += pm;
    sum.theirs += pt;
    const tm = round.players[mySide].tally;
    sum.kills += tm.kills;
    sum.deaths += tm.deaths;
    console.log(
      `Раунд ${String(i + 1).padStart(2)} · ${round.map.name.padEnd(11)} · ты база ${mySide === 0 ? '1' : '2'} · ${result} · ${pm.toFixed(1).padStart(5)}% vs ${pt.toFixed(1).padStart(5)}%` +
      ` · захватов ${tm.captures}, срезал ${tm.kills}, погиб ${tm.deaths}${tm.selfDeaths ? ` (сам ${tm.selfDeaths})` : ''}${tm.wallDeaths ? ` (край ${tm.wallDeaths})` : ''}`,
    );
    if (opts.save) {
      const replay = rec.finish({ round: i + 1 });
      const dir = resolve(process.cwd(), opts.save);
      writeFileSync(join(dir, `round-${i + 1}.json`), JSON.stringify(replay));
      writeFileSync(join(dir, `round-${i + 1}.md`), summarize(replay, mySide));
    }
  }

  console.log(`\nИтог: ${score.win} побед, ${score.loss} поражений, ${score.draw} ничьих`);
  console.log(`Средняя территория: ты ${(sum.mine / opts.rounds).toFixed(1)}%, соперник ${(sum.theirs / opts.rounds).toFixed(1)}%. Срезал ${sum.kills}, погиб ${sum.deaths}.`);
  for (const e of [me, foe]) {
    const avg = e.calls ? e.timeSum / e.calls : 0;
    const warn = e.timeMax > 50 || avg > 10 ? '  ← СЛИШКОМ МЕДЛЕННО: в браузере будут пропуски ходов' : '';
    console.log(`${e.name}: tick в среднем ${avg.toFixed(3)} мс, максимум ${e.timeMax.toFixed(1)} мс, ходов дольше 50 мс ${e.slow}, ошибок ${e.errors}${warn}`);
  }
  console.log(`(${TICK_RATE} ходов в секунду; лимит на ход в браузере — 50 мс)`);
  if (opts.save) console.log(`Реплеи: ${resolve(process.cwd(), opts.save)}`);
  console.log('');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
