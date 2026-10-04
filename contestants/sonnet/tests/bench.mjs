// Параллельный замер: node tests/bench.mjs <папка бота> --vs raider,farmer,bot --seeds 1,2,3 --rounds 6 --par 12
// Зерно (BOT_SEED) и настройки (BOT_CFG, BOT_CFG0 — наш бот, BOT_CFG1 — соперник при --vs bot) читаются из окружения;
// для сравнения вариантов: --cfg0 '{"over":120}' --cfg1 '{}'. Зеркало бота — монетка, нужно ≥144 раунда на замер.
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const botDir = args[0] && !args[0].startsWith('--') ? args[0] : 'bot';
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const vs = opt('vs', 'raider,farmer').split(',');
const seeds = opt('seeds', '1').split(',');
const rounds = opt('rounds', '6');
const cfg0 = opt('cfg0', ''); const cfg1 = opt('cfg1', ''); const cfg = opt('cfg', '');
const jobs = [];
for (const v of vs) for (const sd of seeds) jobs.push({ v, sd });
const results = [];
let running = 0, idx = 0;
const MAXP = Number(opt('par', '6'));
function next() {
  while (running < MAXP && idx < jobs.length) {
    const j = jobs[idx++];
    running++;
    const p = spawn('node', ['arena/cli.mjs', botDir, '--vs', j.v, '--rounds', rounds], { env: { ...process.env, BOT_SEED: j.sd, ...(cfg0 ? { BOT_CFG0: cfg0 } : {}), ...(cfg1 ? { BOT_CFG1: cfg1 } : {}), ...(cfg ? { BOT_CFG: cfg } : {}) } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => {
      running--;
      const m = out.match(/Итог: (\d+) побед, (\d+) поражений, (\d+) ничьих/);
      const t = out.match(/Средняя территория: ты ([\d.]+)%, соперник ([\d.]+)%\. Срезал (\d+), погиб (\d+)/);
      const tm = out.match(/tick в среднем ([\d.]+) мс, максимум ([\d.]+) мс/);
      results.push({ ...j, w: +m?.[1], l: +m?.[2], d: +m?.[3], me: +t?.[1], en: +t?.[2], k: +t?.[3], dt: +t?.[4], avg: +tm?.[1], max: +tm?.[2], raw: m ? null : out });
      next();
      if (running === 0 && idx >= jobs.length) report();
    });
  }
}
function report() {
  results.sort((a, b) => (a.v + a.sd).localeCompare(b.v + b.sd));
  const byV = {};
  for (const r of results) {
    if (r.raw) { console.log('ERR', r.v, r.sd, r.raw.slice(0, 400)); continue; }
    const b = (byV[r.v] ||= { w: 0, l: 0, d: 0, me: 0, en: 0, n: 0, k: 0, dt: 0, max: 0 });
    b.w += r.w; b.l += r.l; b.d += r.d; b.me += r.me; b.en += r.en; b.n++; b.k += r.k; b.dt += r.dt; b.max = Math.max(b.max, r.max);
    console.log(`  ${r.v.padEnd(8)} seed ${r.sd}: ${r.w}-${r.l}-${r.d}  ${r.me}% vs ${r.en}%  kills ${r.k} deaths ${r.dt}  tmax ${r.max}ms`);
  }
  console.log('---');
  for (const [v, b] of Object.entries(byV)) console.log(`${v.padEnd(8)} W-L-D ${b.w}-${b.l}-${b.d}  avg ${(b.me / b.n).toFixed(1)}% vs ${(b.en / b.n).toFixed(1)}%  kills ${b.k} deaths ${b.dt}  tmax ${b.max.toFixed(1)}ms`);
}
next();
