#!/usr/bin/env node
/**
 * Восстановление повреждённого PoB share-кода (потеря байтов в СЕРЕДИНЕ).
 * decodeShareCode требует целостного потока и падает; здесь же распаковываем
 * zlib инкрементально и спасаем всё, что распаковалось до места разрыва.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Unzlib } from 'fflate';

const file = process.argv[2] ?? '_test_share_code.txt';
const raw64 = readFileSync(file, 'utf8').replace(/\s+/g, '');
const s = raw64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (raw64.length % 4)) % 4);
const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
console.log(`Файл: ${file} | base64 chars: ${raw64.length} | байтов: ${bytes.length}`);

// Инкрементальная распаковка: собираем всё, что удалось распаковать до ошибки.
const chunks = [];
let err = null;
const infl = new Unzlib();
infl.ondata = (a, b, c) => {
  // успех: (data, final); ошибка: (err, data, final)
  if (a instanceof Error) { err = a; return; }
  if (a?.length) chunks.push(Uint8Array.from(a));
  const final = typeof b === 'boolean' ? b : c === true;
  if (final) infl.eof = true;
};
try { infl.push(bytes, true); } catch (e) { err = e; }

const salvaged = chunks.length
  ? Uint8Array.from(chunks.flatMap((c) => [...c]))
  : new Uint8Array(0);
console.log(`Распаковано до разрыва: ${salvaged.length} байт${err ? ` (ошибка: ${String(err).slice(0, 100)})` : ' — поток цел!'}`);

const text = new TextDecoder('utf-8', { fatal: false }).decode(salvaged);
console.log(`XML-текста спасено: ${text.length} симв. | PathOfBuilding: ${text.includes('PathOfBuilding')}`);

const cut = text.lastIndexOf('>') + 1; // срез по последнему целому тегу
const partial = text.slice(0, cut);
writeFileSync('_recovered_partial.xml', partial);
console.log(`Сохранено: _recovered_partial.xml (${partial.length} симв., срез по целому тегу)`);

// Диагностика: что успело распаковаться
for (const tag of ['<Build', '<Tree', '<Items', '<Item ', '<Skills', '<Calcs']) {
  console.log(`  ${tag}: ${partial.includes(tag) ? '✔' : '✘'}`);
}
const items = partial.match(/<Item\b/g)?.length ?? 0;
const slots = partial.match(/<Slot\b/g)?.length ?? 0;
console.log(`  <Item>: ${items} | <Slot>: ${slots}`);

if (Object.prototype.hasOwnProperty.call(infl, 'eof') ? false : false) { /* noop */ }
