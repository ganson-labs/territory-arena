// Static server for the viewer, team discovery and saving round files. No dependencies.
//   node serve.mjs [--port 4747]
// Contestants live outside the arena (see new-contestant.mjs). They are found in arena.config.json,
// in contestants/<id>/ (teams shipped with the arena, read-only) or passed as absolute paths in the
// viewer link (?a=C:/arena-sonnet). Their files are served
// under /team/<key>/, round files are written to <their folder>/rounds/.
import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 4747;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
};

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

const ASSET_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const ASSET_MAX_FILES = 20;
const ASSET_MAX_BYTES = 2 * 1024 * 1024;

// The team's own pictures from bot/assets/: at most 20 files and 2 MB together, the rest is skipped.
async function listAssets(botDir, urlDir) {
  const dir = join(botDir, 'assets');
  if (!existsSync(dir)) return [];
  const out = [];
  let total = 0;
  for (const name of (await readdir(dir)).sort()) {
    if (!ASSET_EXT.has(extname(name).toLowerCase()) || !/^[\w.\-]+$/.test(name)) continue;
    const st = await stat(join(dir, name));
    if (!st.isFile() || out.length >= ASSET_MAX_FILES || total + st.size > ASSET_MAX_BYTES) continue;
    total += st.size;
    out.push({ name, url: `${urlDir}assets/${name}` });
  }
  return out;
}

// key -> absolute folder of a contestant, filled by listBots().
const teams_ = new Map();

async function listBots(extra = []) {
  const bots = [];
  const sparring = join(root, 'kit', 'arena', 'sparring');
  for (const name of await readdir(sparring)) {
    const dir = join(sparring, name);
    if (!existsSync(join(dir, 'bot.js'))) continue;
    bots.push({
      id: `sparring/${name}`,
      dir: `/kit/arena/sparring/${name}/`,
      model: 'Спарринг',
      color: (await readJson(join(dir, 'team.json'))).color || '#9aa39a',
      hasSkin: existsSync(join(dir, 'skin.js')),
      assets: await listAssets(dir, `/kit/arena/sparring/${name}/`),
      saveable: false,
    });
  }
  const cfg = await readJson(join(root, 'arena.config.json'));
  const teams = Object.entries(cfg.contestants || {}).map(([id, c]) => ({ key: id, dir: c.dir, model: c.model, color: c.color }));
  // Teams shipped with the arena (contestants/<id>/, e.g. the tournament from the video): read-only,
  // so a live match never overwrites their recorded rounds.
  const bundled = join(root, 'contestants');
  if (existsSync(bundled)) {
    for (const name of (await readdir(bundled)).sort()) {
      if (!teams.some((t) => t.key === name)) teams.push({ key: name, dir: join(bundled, name), readOnly: true });
    }
  }
  for (const p of extra) teams.push({ key: p, dir: p });
  for (const t of teams) {
    const dir = resolve(String(t.dir || ''));
    if (!existsSync(join(dir, 'bot', 'bot.js'))) continue;
    const meta = await readJson(join(dir, 'contestant.json'));
    teams_.set(t.key, dir);
    const base = `/team/${encodeURIComponent(t.key)}/`;
    if (bots.some((b) => b.id === t.key)) continue;
    bots.push({
      id: t.key,
      dir: `${base}bot/`,
      model: meta.model || t.model || t.key,
      color: meta.color || t.color || '#e0e0e0',
      hasSkin: existsSync(join(dir, 'bot', 'skin.js')),
      assets: await listAssets(join(dir, 'bot'), `${base}bot/`),
      saveable: !t.readOnly,
    });
  }
  return bots;
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        fail(new Error('слишком большой запрос'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

// POST /api/round { id: "contestants/<name>", n, replay, md } -> contestants/<name>/rounds/round-N.{json,md}
async function saveRound(req, res) {
  const body = JSON.parse(await readBody(req));
  const dirOf = teams_.get(String(body.id || ''));
  const n = Number(body.n);
  if (!dirOf || !Number.isInteger(n) || n < 1 || n > 99 || typeof body.md !== 'string' || !body.replay) {
    res.writeHead(400, { 'content-type': TYPES['.json'] });
    res.end(JSON.stringify({ error: 'неверный запрос' }));
    return;
  }
  const dir = join(dirOf, 'rounds');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `round-${n}.json`), JSON.stringify(body.replay));
  await writeFile(join(dir, `round-${n}.md`), body.md);
  const md = join(dir, `round-${n}.md`);
  console.log(`раунд ${n} записан: ${md}`);
  res.writeHead(200, { 'content-type': TYPES['.json'] });
  res.end(JSON.stringify({ ok: true, md }));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/bots') {
      const extra = url.searchParams.getAll('path').filter((p) => /^([a-zA-Z]:)?[\\/]/.test(p));
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      res.end(JSON.stringify(await listBots(extra)));
      return;
    }
    if (url.pathname === '/api/round' && req.method === 'POST') {
      await saveRound(req, res);
      return;
    }
    if (url.pathname === '/' || url.pathname === '/viewer') {
      res.writeHead(302, { location: `/viewer/${url.search}` });
      res.end();
      return;
    }
    let base = root;
    let path = url.pathname;
    const team = /^\/team\/([^/]+)(\/.*)$/.exec(path);
    if (team) {
      base = teams_.get(decodeURIComponent(team[1]));
      if (!base) throw Object.assign(new Error('unknown team'), { code: 'ENOENT' });
      path = team[2];
    }
    path = decodeURIComponent(path);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(base, path));
    if (!file.startsWith(base + sep)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(err.code || err.message));
  }
}).listen(port, '127.0.0.1', () => console.log(`Захват территории: http://localhost:${port}`));
