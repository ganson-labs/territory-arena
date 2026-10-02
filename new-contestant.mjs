// Create a clean workspace for one contestant: a copy of kit/ with its own git.
//   node new-contestant.mjs sonnet --model "Claude Sonnet 5.5" --color "#e8825a"
//   node new-contestant.mjs sol    --model "GPT-6.1 Sol"       --color "#4fc3c9"
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  console.error('Использование: node new-contestant.mjs <id латиницей> --model "Название модели" --color "#hex"');
  process.exit(1);
}
const dir = join(root, 'contestants', id);
if (existsSync(dir)) {
  console.error(`${dir} уже существует. Удали или переименуй её вручную, если нужен чистый старт.`);
  process.exit(1);
}

cpSync(join(root, 'kit'), dir, { recursive: true });
writeFileSync(join(dir, 'contestant.json'), JSON.stringify({ model: opt('model', id), color: opt('color', '#e0e0e0') }, null, 2) + '\n');

const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=Territory Arena', '-c', 'user.email=arena@localhost', 'commit', '-qm', 'Стартовый набор арены');

console.log(`Готово: ${dir}`);
console.log('Запусти агента в этой папке и дай ему промпт из prompts/territory-battle.md');
