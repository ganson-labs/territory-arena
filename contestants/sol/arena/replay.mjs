#!/usr/bin/env node
// Разбор раунда без браузера.
//   node arena/replay.mjs rounds/round-1.json               -> сводка + карта поля каждые 30 с
//   node arena/replay.mjs rounds/round-1.json --at 47.5     -> карта поля в момент 0:47.5
//   node arena/replay.mjs rounds/round-1.json --every 10    -> карты каждые 10 с
//   node arena/replay.mjs rounds/round-1.json --events      -> все гибели и захваты
//   node arena/replay.mjs rounds/round-1.json --from 40 --to 45  -> положение, курс и поворот обеих сторон по тикам
//   --as 0|1  — чьими глазами смотреть (по умолчанию сторона из поля "you" или 0)
import { readFileSync } from 'node:fs';
import { COLS, ROWS, CELLS, TICK_RATE, replayRound } from './engine.js';
import { summarize, clock, verifyReplay, REPLAY_FORMAT } from './report.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^-?\d/.test(a));
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!file) {
  console.log('node arena/replay.mjs <round-N.json> [--at сек] [--every сек] [--events] [--from сек --to сек] [--as 0|1]');
  process.exit(1);
}
const replay = JSON.parse(readFileSync(file, 'utf8'));
if (replay.format !== REPLAY_FORMAT) console.warn(`Неизвестный формат: ${replay.format}`);
const you = opt('as') != null ? Number(opt('as')) : replay.you ?? 0;
const foe = 1 - you;
const SX = 2; // one character = 2x2 raster cells = 20x20 units

// Карта поля: # — твоя земля, + — твой хвост, @ — твоя голова; o — земля соперника, ~ — его хвост, X — его голова.
function drawMap(round) {
  const w = COLS / SX;
  const h = ROWS / SX;
  const rows = [];
  rows.push('     ' + Array.from({ length: w }, (_, x) => (x % 10 === 0 ? String((x * SX * 10) / 100).padEnd(1) : ' ')).join(''));
  for (let y = 0; y < h; y++) {
    let s = '';
    for (let x = 0; x < w; x++) {
      const me = round.players[you];
      const en = round.players[foe];
      const hit = (p) => p.alive && Math.floor(p.x / 10 / SX) === x && Math.floor(p.y / 10 / SX) === y;
      if (hit(me)) { s += '@'; continue; }
      if (hit(en)) { s += 'X'; continue; }
      let c = { mt: 0, et: 0, ml: 0, el: 0 };
      for (let dy = 0; dy < SX; dy++) {
        for (let dx = 0; dx < SX; dx++) {
          const i = (y * SX + dy) * COLS + x * SX + dx;
          if (round.trail[i] === you) c.mt++;
          else if (round.trail[i] === foe) c.et++;
          if (round.land[i] === you) c.ml++;
          else if (round.land[i] === foe) c.el++;
        }
      }
      s += c.mt ? '+' : c.et ? '~' : c.ml >= 2 ? '#' : c.el >= 2 ? 'o' : '.';
    }
    rows.push(String(y * SX * 10).padStart(4) + ' ' + s);
  }
  return rows.join('\n');
}

const check = verifyReplay(replay);
console.log(summarize(replay, you));
if (!check.ok) console.log(`ВНИМАНИЕ: пересчёт движком дал ${check.cells.join(' / ')} клеток, в файле ${replay.result.cells.join(' / ')}. Реплей записан другой версией движка?\n`);

const at = opt('at') != null ? [Number(opt('at'))] : null;
const every = Number(opt('every') || 30);
const marks = new Set((at || Array.from({ length: Math.floor(120 / every) + 1 }, (_, k) => k * every)).map((s) => Math.round(s * TICK_RATE)));
const showEvents = args.includes('--events');
const from = opt('from') != null ? Math.round(Number(opt('from')) * TICK_RATE) : null;
const to = opt('to') != null ? Math.round(Number(opt('to')) * TICK_RATE) : null;
const who = (side) => (side === you ? 'ты' : 'соперник');

console.log('Обозначения: # твоя земля, + твой хвост, @ твоя голова; o земля соперника, ~ его хвост, X его голова; . пусто.');
console.log('Один символ — квадрат 20×20 единиц поля; слева координата y, сверху x в сотнях единиц. Поле 1600×1000, курс в градусах: 0 — вправо, 90 — вниз.\n');
const pctOf = (round, s) => ((100 * round.players[s].cells) / CELLS).toFixed(1);
replayRound(replay, (round, events) => {
  if (showEvents) {
    for (const e of events) {
      if (e.type === 'death') console.log(`${clock(round.tick)} т${round.tick}: погиб ${who(e.side)} (${e.cause}) в (${Math.round(e.x)}, ${Math.round(e.y)}), хвост ${e.trailLength * 10} ед.`);
      if (e.type === 'capture') console.log(`${clock(round.tick)} т${round.tick}: ${who(e.side)} захватил ${((100 * e.count) / CELLS).toFixed(1)}% поля (у соперника ${((100 * e.stolen) / CELLS).toFixed(1)}%), хвост ${e.trailLength * 10} ед.`);
    }
  }
  if (from != null && round.tick > from && round.tick <= (to ?? from + 60)) {
    const t = round.tick - 1;
    const p = round.players;
    const f = (s) => `${who(s)} поворот ${(replay.moves[s][t] / 1000).toFixed(2)} → (${Math.round(p[s].x)}, ${Math.round(p[s].y)}) курс ${Math.round(p[s].heading)}° хвост ${p[s].trailCells.length * 10} ед.${p[s].alive ? '' : ' (мёртв)'}`;
    console.log(`т${t}: ${f(you)} · ${f(foe)}`);
  }
  if (marks.has(round.tick)) {
    console.log(`--- ${clock(round.tick)} (тик ${round.tick}): ты ${pctOf(round, you)}%, соперник ${pctOf(round, foe)}% ---`);
    console.log(drawMap(round));
    console.log('');
  }
});
