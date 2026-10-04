import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Принимает PNG от стенда (window.__shot / __crop) и кладёт в preview/shots, чтобы кадры можно было открыть файлом.
const out = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(out, { recursive: true });
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const name = (url.searchParams.get('name') || 'shot').replace(/[^\w.-]/g, '_');
    writeFileSync(join(out, name + '.png'), Buffer.concat(chunks));
    res.end('ok');
  });
}).listen(8124, () => console.log('saver on 8124'));
