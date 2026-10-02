// Create a clean workspace for one contestant OUTSIDE the arena: a copy of kit/ with its own git,
// so a model never sees the arena, the viewer or the other contestant.
//   node new-contestant.mjs sonnet --model "Claude Sonnet 5.5" --color "#e8825a"            -> C:\arena-sonnet
//   node new-contestant.mjs sol    --model "GPT-6.1 Sol"       --color "#4fc3c9" --dir D:\x\sol
// The contestant is registered in arena.config.json (arena root), which the viewer reads.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const args = process.argv.slice(2);
const id = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : fallback;
};

if (!id || !/^[a-z0-9-]+$/.test(id)) {
  console.error('Использование: node new-contestant.mjs <id латиницей> --model "Название модели" --color "#цвет" [--dir путь]');
  process.exit(1);
}
const dir = resolve(opt('dir', join(parse(root).root, `arena-${id}`)));
if (dir === root || dir.startsWith(root + '\\') || dir.startsWith(root + '/')) {
  console.error('Папка участника должна быть вне арены, иначе модель увидит арену и соперника.');
  process.exit(1);
}
if (existsSync(dir)) {
  console.error(`${dir} уже существует. Удали или переименуй её вручную, если нужен чистый старт.`);
  process.exit(1);
}

cpSync(join(root, 'kit'), dir, { recursive: true });
const meta = { model: opt('model', id), color: opt('color', '#e0e0e0') };
writeFileSync(join(dir, 'contestant.json'), JSON.stringify(meta, null, 2) + '\n');

const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=Territory Arena', '-c', 'user.email=arena@localhost', 'commit', '-qm', 'Стартовый набор арены');

const cfgFile = join(root, 'arena.config.json');
let cfg = { contestants: {} };
try {
  cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
} catch {}
cfg.contestants ??= {};
cfg.contestants[id] = { dir, ...meta };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');

console.log(`Готово: ${dir}`);
console.log(`Записан в arena.config.json как «${id}». Запусти агента в этой папке и дай ему промпт из prompts/territory-battle.md`);
