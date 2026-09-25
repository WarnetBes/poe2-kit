// Сформировать дайджест-вклад в библиотеку предметов (для ПОЛЬЗОВАТЕЛЯ kit).
//
// Как это работает (см. docs/CONTRIBUTING.md):
//   1. Включите opt-in журнал: `setx POE2K_LEARN 1` (PowerShell) и
//      перезапустите kit (оверлей/MCP/веб). Проверяйте предметы как обычно —
//      форма каждого предмета пишется ЛОКАЛЬНО в ~/.poe2-kit/learn/items.jsonl.
//      Никакие имена персонажей/аккаунты НЕ собираются.
//   2. Запустите: npm run contribute-items -w @poe2-kit/core
//   3. Скрипт создаст poe2-items-contribution-<дата>.json — проверьте содержимое.
//   4. Приложите файл к issue на SourceCraft:
//      https://sourcecraft.dev/volkovpartilaholin/poe2-kit/issues (заголовок
//      «Item data contribution»).
//
// Выход: 0 = дайджест готов; 1 = журнал пуст/ошибка.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { readLearnedItems, buildItemContribution, learnLogInfo } from './dist/learnlog.js';

const ISSUE_URL = 'https://sourcecraft.dev/volkovpartilaholin/poe2-kit/issues';

function out() {
  const base = process.env['POE2_KIT_LEARN_DIR'] ?? join(homedir(), '.poe2-kit', 'learn');
  return join(base, 'items.jsonl');
}

function kitVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    return pkg.version ?? undefined;
  } catch {
    return undefined;
  }
}

(() => {
  const info = learnLogInfo();
  console.log('POE2 Kit · вклад в библиотеку предметов');
  console.log('  журнал:', existsSync(out()) ? out() : '(не найден)', );
  console.log('  записей:', info.records);
  if (!info.enabled) {
    console.warn('\n⚠ Журнал обучения сейчас ВЫКЛЮЧЕН (это opt-in).');
    console.warn('  Включить (PowerShell): setx POE2K_LEARN 1 — и перезапустить kit.');
  }
  const items = readLearnedItems();
  if (!items.length) {
    console.error('\nЖурнал пуст — нечего отправлять. Включите POE2K_LEARN=1, проверьте');
    console.error('несколько предметов прайс-чеком и повторите.');
    process.exit(1);
  }
  const contrib = buildItemContribution(items);
  contrib.kitVersion = kitVersion();
  const file = `poe2-items-contribution-${contrib.generatedAt.slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(contrib, null, 2), 'utf8');
  console.log(`\n✓ Дайджест: ${file} — ${contrib.entries.length} уникальных форм предметов.`);
  console.log('  Содержимое — только данные о предметах (базы/моды/stat-id),');
  console.log('  без имени персонажа и аккаунта. Проверьте файл перед отправкой.');
  console.log(`\nСледующий шаг: создайте issue ${ISSUE_URL}`);
  console.log('с заголовком «Item data contribution» и приложите файл.');
})();
