#!/usr/bin/env node
/**
 * E5 (мастер-план §4): извлечь канонические EN stat-шаблоны PoB2 из
 * PathOfBuilding-PoE2-i18n stats.po (msgid) в data-файл пакета core.
 *
 * Никакого рантайма: результат — packages/core/data/pob2_stat_templates.txt
 * (по одному msgid в строке, LF, уникальные, отсортированы). Файл —
 * верификационный корпус для pob2_stat_templates.test.ts, НЕ подключается
 * к рантайм-коду.
 *
 * msgid — строки игровых данных GGG (фактический формат, не креативный
 * код); статистика: LICENSE-файла в клоне PoB2-i18n нет, идеология донора —
 * форк MIT-PoB2 (мастер-план §8: используем только как data-facts).
 *
 * Usage: node scripts/extract-pob2-stats.mjs [stats.po]
 *   default stats.po = ../../_research/PathOfBuilding-PoE2-i18n/locale/zh_TW/LC_MESSAGES/stats.po
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const poPath =
  process.argv[2] ??
  join(here, '..', '..', '_research', 'PathOfBuilding-PoE2-i18n', 'locale', 'zh_TW', 'LC_MESSAGES', 'stats.po');
const outPath = join(here, '..', 'packages', 'core', 'data', 'pob2_stat_templates.txt');

if (!existsSync(poPath)) {
  console.error(`stats.po не найден: ${poPath}`);
  console.error('Укажите путь: node scripts/extract-pob2-stats.mjs <stats.po>');
  process.exit(1);
}

/** Разыменовать po-строку: "...\n..." → JSON-unescape содержимого. */
function unquote(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
}

// Мини-парсер .po: нас интересуют только блоки msgid (не msgid_plural),
// с конкатенацией многострочных продолжений ("строки-хвосты" без префикса).
const raw = readFileSync(poPath, 'utf8');
const lines = raw.split(/\r?\n/);
const msgids = new Set();
let cur = null; // собираемый msgid ('\n'-конкатенация хвостов)
const close = () => {
  if (cur !== null && cur.trim()) msgids.add(cur);
  cur = null;
};
for (const line of lines) {
  const mMsgid = /^msgid "(.*)"$/.exec(line);
  if (mMsgid) {
    close();
    cur = unquote(mMsgid[1]);
    continue;
  }
  if (cur === null) continue;
  if (/^\s*msgid_plural|^\s*msgstr/.test(line)) {
    close();
    continue;
  }
  const mCont = /^"(.*)"$/.exec(line);
  if (mCont) cur += '\n' + unquote(mCont[1]);
}
close();

// Фильтр: пустые, заголовок; многострочные msgid экранируются в одну строку
// ('\n' → literal '\n') — файл строго «одна запись = одна строка».
const items = [...msgids]
  .map((s) => s.trim().replace(/\\/g, '\\\\').replace(/\n/g, '\\n'))
  .filter((s) => s.length > 0 && s.length < 400)
  .sort();

writeFileSync(outPath, items.join('\n') + '\n', 'utf8');
const withPh = items.filter((s) => /\{\d/.test(s)).length;
console.log(`msgid уникальных: ${items.length} (с {N}-плейсхолдером: ${withPh})`);
console.log(`→ ${outPath}`);
