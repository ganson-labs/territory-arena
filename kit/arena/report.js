// Запись раунда в реплей и короткая сводка для участника. Без DOM и Node API.
import { W, H, CELLS, TICK_RATE, ROUND_SECONDS, MAPS, percentOf, replayRound } from './engine.js';

export const REPLAY_FORMAT = 'territory-replay/1';

const pct = (cells) => Math.round((1000 * cells) / CELLS) / 10;
export const clock = (tick) => {
  const s = Math.floor(tick / TICK_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Записывает раунд по ходу игры: доли поля раз в секунду и важные события.
export function createRecorder(round) {
  const timeline = [{ t: 0, percent: [percentOf(round, 0), percentOf(round, 1)].map(round1) }];
  const events = [];
  return {
    step(events_) {
      for (const e of events_) {
        if (e.type === 'death') {
          events.push({ tick: round.tick, type: 'death', side: e.side, cause: e.cause, by: e.by ?? null, x: e.x, y: e.y, lostCells: e.lostCells, trailLength: e.trailLength });
        } else if (e.type === 'capture') {
          events.push({ tick: round.tick, type: 'capture', side: e.side, count: e.count, stolen: e.stolen, trailLength: e.trailLength, x: Math.round(e.x), y: Math.round(e.y) });
        } else if (e.type === 'respawn') {
          events.push({ tick: round.tick, type: 'respawn', side: e.side });
        }
      }
      if (round.tick % TICK_RATE === 0) timeline.push({ t: round.tick / TICK_RATE, percent: [percentOf(round, 0), percentOf(round, 1)].map(round1) });
    },
    finish(meta = {}) {
      return {
        format: REPLAY_FORMAT,
        round: meta.round ?? 1,
        mapIndex: round.mapIndex,
        mapName: round.map.name,
        width: W,
        height: H,
        tickRate: TICK_RATE,
        players: round.players.map((p, side) => ({ side, name: p.name, ...(meta.players?.[side] || {}) })),
        moves: [...round.moves],
        result: {
          winner: round.winner,
          ticks: round.tick,
          cells: round.players.map((p) => p.cells),
          percent: [percentOf(round, 0), percentOf(round, 1)].map(round1),
        },
        tallies: round.players.map((p) => ({ ...p.tally })),
        timeline,
        events,
        health: meta.health || null,
        match: meta.match || null,
      };
    },
  };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// Проверка, что реплей воспроизводится движком клетка в клетку.
export function verifyReplay(replay) {
  const round = replayRound(replay);
  const cells = round.players.map((p) => p.cells);
  const ok = round.winner === replay.result.winner && cells[0] === replay.result.cells[0] && cells[1] === replay.result.cells[1];
  return { ok, round, cells };
}

function where(x, y) {
  const v = y < H / 3 ? 'вверху' : y >= (2 * H) / 3 ? 'внизу' : 'в середине по высоте';
  const h = x < W / 3 ? 'слева' : x >= (2 * W) / 3 ? 'справа' : 'в центре';
  return `(${x}, ${y}) — ${v} ${h}`;
}

const CAUSE = {
  cut: 'соперник наехал на твой хвост',
  self: 'ты наехал на свой хвост',
  wall: 'ты врезался в край поля',
  head: 'столкновение головами не на твоей земле',
  land: 'твою землю обвели целиком',
};
const CAUSE_ENEMY = {
  cut: 'ты наехал на его хвост',
  self: 'он наехал на свой хвост',
  wall: 'он врезался в край поля',
  head: 'столкновение головами не на его земле',
  land: 'ты обвёл всю его землю',
};

function sideStats(replay, side) {
  const caps = replay.events.filter((e) => e.type === 'capture' && e.side === side);
  const deaths = replay.events.filter((e) => e.type === 'death' && e.side === side);
  const t = replay.tallies[side];
  const avgTrail = caps.length ? caps.reduce((a, e) => a + e.trailLength, 0) / caps.length : 0;
  const stolen = caps.reduce((a, e) => a + e.stolen, 0);
  const top = [...caps].sort((a, b) => b.count - a.count).slice(0, 3);
  return { caps, deaths, t, avgTrail, stolen, top };
}

// Сводка раунда с точки зрения стороны `you`.
export function summarize(replay, you) {
  const foe = 1 - you;
  const me = replay.players[you];
  const en = replay.players[foe];
  const r = replay.result;
  const res = r.winner == null ? 'НИЧЬЯ' : r.winner === you ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  const base = MAPS[replay.mapIndex].bases[you];
  const L = [];
  L.push(`# Раунд ${replay.round}: ${res}`);
  L.push('');
  L.push(`Ты — «${me.name}», соперник — «${en.name}»${en.model ? ` (${en.model})` : ''}.`);
  L.push(`Карта «${replay.mapName}», твоя база в (${base.x}, ${base.y}), ты играл стороной ${you} (${you === 0 ? 'первая база' : 'вторая база'}).`);
  L.push(`Итог по территории: ты ${r.percent[you]}%, соперник ${r.percent[foe]}% поля.`);
  if (replay.match?.score) L.push(`Счёт матча после раунда: ты ${replay.match.score[you]}, соперник ${replay.match.score[foe]}.`);
  L.push('');
  L.push('## Территория по времени');
  L.push('');
  L.push('| время | ты | соперник |');
  L.push('|---|---|---|');
  for (const p of replay.timeline) {
    if (p.t % 15 === 0 || p.t === ROUND_SECONDS) L.push(`| ${clock(p.t * TICK_RATE)} | ${p.percent[you]}% | ${p.percent[foe]}% |`);
  }
  const peak = replay.timeline.reduce((m, p) => (p.percent[you] > m.percent[you] ? p : m), replay.timeline[0]);
  L.push('');
  L.push(`Твой пик: ${peak.percent[you]}% на ${clock(peak.t * TICK_RATE)}.`);

  const mine = sideStats(replay, you);
  const theirs = sideStats(replay, foe);
  L.push('');
  L.push('## Где и как ты погибал');
  L.push('');
  if (!mine.deaths.length) L.push('Ни разу.');
  for (const d of mine.deaths) {
    L.push(`- ${clock(d.tick)} — ${CAUSE[d.cause] || d.cause}; голова в ${where(d.x, d.y)}, хвост ${d.trailLength} клеток, сгорело ${pct(d.lostCells)}% поля.`);
  }
  L.push('');
  L.push('## Гибели соперника');
  L.push('');
  if (!theirs.deaths.length) L.push('Ни разу.');
  for (const d of theirs.deaths) {
    L.push(`- ${clock(d.tick)} — ${CAUSE_ENEMY[d.cause] || d.cause}; его голова в ${where(d.x, d.y)}, хвост ${d.trailLength} клеток, у него сгорело ${pct(d.lostCells)}% поля.`);
  }
  const describe = (s, who) => {
    const out = [];
    out.push(`- Захватов: ${s.caps.length}, всего +${pct(s.t.captured)}% поля, в среднем хвост ${s.avgTrail.toFixed(1)} клеток, самый длинный хвост ${s.t.maxTrail}.`);
    if (s.top.length) out.push(`- Крупнейшие: ${s.top.map((e) => `+${pct(e.count)}% на ${clock(e.tick)} у ${where(e.x, e.y)}`).join('; ')}.`);
    if (s.stolen) out.push(`- Отнял у ${who} ${pct(s.stolen)}% поля обводом.`);
    out.push(`- Вне своей земли ${Math.round((100 * s.t.ticksOut) / Math.max(1, replay.result.ticks))}% времени, мёртв ${Math.round((100 * s.t.ticksDead) / Math.max(1, replay.result.ticks))}% времени.`);
    out.push(`- Срезал хвостов: ${s.t.kills}, погиб: ${s.t.deaths} (на свой хвост ${s.t.selfDeaths}, в край поля ${s.t.wallDeaths}).`);
    return out;
  };
  L.push('');
  L.push('## Что делал ты');
  L.push('');
  L.push(...describe(mine, 'соперника'));
  L.push('');
  L.push('## Что делал соперник');
  L.push('');
  L.push(...describe(theirs, 'тебя'));
  if (replay.health) {
    const h = replay.health[you];
    if (h && (h.missed || h.errors || h.frozen)) {
      L.push('');
      L.push('## Сбои твоего бота');
      L.push('');
      L.push(`Пропущено ходов (дольше 50 мс): ${h.missed}, ошибок: ${h.errors}${h.frozen ? ', бот завис и был отключён' : ''}.${h.lastError ? ` Последняя ошибка: ${h.lastError}` : ''}`);
    }
  }
  L.push('');
  L.push('Полный реплей рядом в .json. Разбор по ходам и карта поля в любой момент: `node arena/replay.mjs rounds/round-N.json --at 60`.');
  return L.join('\n') + '\n';
}
