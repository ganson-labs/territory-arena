#!/usr/bin/env node
// Разбор раунда без браузера.
//   node arena/replay.mjs rounds/round-1.json               -> сводка + карта поля каждые 30 с
//   node arena/replay.mjs rounds/round-1.json --at 47.5     -> карта поля в момент 0:47.5
//   node arena/replay.mjs rounds/round-1.json --every 10    -> карты каждые 10 с
//   node arena/replay.mjs rounds/round-1.json --events      -> все гибели и захваты по ходам
//   node arena/replay.mjs rounds/round-1.json --from 40 --to 50  -> ходы обеих сторон по тикам
//   --as 0|1  — чьими глазами смотреть (по умолчанию сторона из поля "you" или 0)
import { readFileSync } from 'node:fs';
import { W, H, TICK_RATE, idx, replayRound } from './engine.js';
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

// Карта поля: # — твоя земля, + — твой хвост, @ — твоя голова; o — земля соперника, ~ — его хвост, X — его голова.
function drawMap(round) {
  const rows = [];
  rows.push('    ' + Array.from({ length: W }, (_, x) => (x % 10 === 0 ? String(x / 10) : ' ')).join(''));
  rows.push('    ' + Array.from({ length: W }, (_, x) => String(x % 10)).join(''));
  for (let y = 0; y < H; y++) {
    let s = '';
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const me = round.players[you];
      const en = round.players[foe];
      if (me.alive && me.x === x && me.y === y) s += '@';
      else if (en.alive && en.x === x && en.y === y) s += 'X';
      else if (round.trail[i] === you) s += '+';
      else if (round.trail[i] === foe) s += '~';
      else if (round.land[i] === you) s += '#';
      else if (round.land[i] === foe) s += 'o';
      else s += '.';
    }
    rows.push(String(y).padStart(3) + ' ' + s);
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
const NAMES = ['ты', 'соперник'];
const who = (side) => (side === you ? NAMES[0] : NAMES[1]);

console.log('Обозначения: # твоя земля, + твой хвост, @ твоя голова; o земля соперника, ~ его хвост, X его голова; . пусто. Координаты (x, y), y вниз.\n');
const printAt = (round) => {
  const p = round.players;
  console.log(`--- ${clock(round.tick)} (тик ${round.tick}): ты ${(100 * p[you].cells / (W * H)).toFixed(1)}%, соперник ${(100 * p[foe].cells / (W * H)).toFixed(1)}% ---`);
  console.log(drawMap(round));
  console.log('');
};
replayRound(replay, (round, events) => {
  if (showEvents) {
    for (const e of events) {
      if (e.type === 'death') console.log(`${clock(round.tick)} т${round.tick}: погиб ${who(e.side)} (${e.cause}) в (${e.x}, ${e.y}), хвост ${e.trailLength}`);
      if (e.type === 'capture') console.log(`${clock(round.tick)} т${round.tick}: ${who(e.side)} захватил ${e.count} клеток (у соперника ${e.stolen}), хвост ${e.trailLength}`);
    }
  }
  if (from != null && round.tick > from && round.tick <= (to ?? from + 50)) {
    const t = round.tick - 1;
    const p = round.players;
    console.log(`т${t}: ты ${replay.moves[you][t]} → (${p[you].x}, ${p[you].y}) хвост ${p[you].trail.length} · соперник ${replay.moves[foe][t]} → (${p[foe].x}, ${p[foe].y}) хвост ${p[foe].trail.length}`);
  }
  if (marks.has(round.tick)) printAt(round);
});
