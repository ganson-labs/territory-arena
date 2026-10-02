// Static server for the viewer, bot discovery and saving round files. No dependencies.
//   node serve.mjs [--port 4747]
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
  '.md': 'text/markdown; charset=utf-8',
};

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

async function listBots() {
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
      saveable: false,
    });
  }
  const contestants = join(root, 'contestants');
  if (existsSync(contestants)) {
    for (const name of await readdir(contestants)) {
      const dir = join(contestants, name);
      if (!(await stat(dir)).isDirectory() || !existsSync(join(dir, 'bot', 'bot.js'))) continue;
      const meta = await readJson(join(dir, 'contestant.json'));
      bots.push({
        id: `contestants/${name}`,
        dir: `/contestants/${name}/bot/`,
        model: meta.model || name,
        color: meta.color || '#e0e0e0',
        hasSkin: existsSync(join(dir, 'bot', 'skin.js')),
        saveable: true,
      });
    }
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
  const m = /^contestants\/([a-z0-9-]+)$/.exec(String(body.id || ''));
  const n = Number(body.n);
  if (!m || !Number.isInteger(n) || n < 1 || n > 99 || typeof body.md !== 'string' || !body.replay) {
    res.writeHead(400, { 'content-type': TYPES['.json'] });
    res.end(JSON.stringify({ error: 'неверный запрос' }));
    return;
  }
  const dir = join(root, 'contestants', m[1], 'rounds');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `round-${n}.json`), JSON.stringify(body.replay));
  await writeFile(join(dir, `round-${n}.md`), body.md);
  console.log(`раунд ${n} записан: contestants/${m[1]}/rounds/round-${n}.md`);
  res.writeHead(200, { 'content-type': TYPES['.json'] });
  res.end(JSON.stringify({ ok: true, md: `contestants/${m[1]}/rounds/round-${n}.md` }));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/bots') {
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      res.end(JSON.stringify(await listBots()));
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
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(err.code || err.message));
  }
}).listen(port, '127.0.0.1', () => console.log(`Захват территории: http://localhost:${port}`));
