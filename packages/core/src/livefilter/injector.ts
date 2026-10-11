/**
 * Live-price loot filter: инжект динамического блока в базовый NeverSink-
 * фильтр + запись на диск (P3, этап C — №445).
 *
 * Перенос идей и микроархитектуры из mrw-overlay-poe2 (MIT):
 * Copyright (c) kadircelebi / mrw-overlay-poe2, MIT — injector.go:15-105.
 * Go→TS — переписывание, атрибуция этой строкой.
 *
 * Ключевые инварианты донора:
 *  - Блок ставится ПЕРЕД первой реальной секцией NS (`#===\n# [[0100]] …\n#===`,
 *    injector.go:61-66): PoE-фильтр = first-match-wins, ценовые правила
 *    обязаны перекрывать NS.
 *  - Старый динамический блок перед каждой вставкой ВЫРЕЗАЕТСЯ целиком
 *    (injector.go:56-60, 73) — иначе блоки накапливаются при каждом обновлении.
 *  - Склейка — ТОЛЬКО конкатенацией строк, без regex-replace готового текста:
 *    в блоке есть «$» (NS-теги), которые replace трактует как группы (injector.go:76-78).
 *  - OneDrive-redirect Documents (injector.go:27-53): %USERPROFILE%\Documents
 *    врёт, реальные/Documents ищутся по списку кандидатов.
 *  - Запись только temp+rename: игра никогда не видит полу-записанный файл.
 */

import { HAS_DISK, fsMod, pathMod } from '../nodeenv.js';

export const DYNAMIC_BLOCK_START = '# [[DYNAMIC LOOT FILTER]]';
export const DYNAMIC_BLOCK_END = '# [[END DYNAMIC LOOT FILTER]]';

// Старыe блоки: баннер-формат генератора — от «#===+ \n # [[DYNAMIC LOOT FILTER]]»
// до «# [[END DYNAMIC LOOT FILTER]]\n #===+» ВКЛЮЧИТЕЛЬНО, иначе хвостовой баннер
// остаётся мусорной строкой. Нежадный [\s\S]*? — только до первого END.
const RE_OLD_BLOCK = /#=+\r?\n# \[\[DYNAMIC LOOT FILTER\]\][\s\S]*?# \[\[END DYNAMIC LOOT FILTER\]\]\r?\n#=+\r?\n(?:\r?\n)*/g;

// Первая реальная секция NS: `#===\n# [[0100]] Gold\n#===` (injector.go:61-66).
const RE_FIRST_SECTION = /^#=+\r?\n# \[\[\d{4}\]\][^\n]*\r?\n#=+/m;

/** Вырезать все прежние динамические блоки (идемпотентность обновлений). */
export function stripOldDynamicBlocks(content: string): string {
  return content.replace(RE_OLD_BLOCK, '');
}

/**
 * Вставить динамический блок в базовый фильтр: перед первой секцией NS
 * (после шапки/кредитов, впереди всех правил), либо наверх чужого фильтра.
 * `block` — текст generateDynamicBlock (маркеры START/END уже внутри);
 * чужой/черновой текст без маркеров оборачивается консервативно (наш END).
 */
export function injectBlock(baseContent: string, block: string): string {
  const base = stripOldDynamicBlocks(baseContent);
  const wrapped = block.includes(DYNAMIC_BLOCK_START)
    ? `${block}\n\n`
    : `${block}\n${DYNAMIC_BLOCK_END}\n\n`;
  const m = RE_FIRST_SECTION.exec(base);
  if (m) {
    // Только конкатенация: «$» в блоке не является группой (injector.go:76-78)
    return base.slice(0, m.index) + wrapped + base.slice(m.index);
  }
  return wrapped + base;
}

// ─── Пути и диск (Node-only; в браузере все функции кидают) ────────────────

/**
 * Кандидаты папки Documents (injector.go:30-53): OneDrive-redirect тянет
 * known-folder за собой, %USERPROFILE%\Documents при этом врёт.
 * roots — расширяемый список (тесты подсовывают свои).
 */
export function candidateDocumentsDirs(roots: readonly string[] = []): string[] {
  const out: string[] = [];
  const add = (p: string | undefined) => {
    if (!p) return;
    if (!out.some((o) => o.toLowerCase() === p!.toLowerCase())) out.push(p);
  };
  for (const r of roots) add(r);
  for (const env of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'] as const) {
    const v = process.env[env];
    if (v) add(pathMod!.join(v, 'Documents'));
  }
  const home = process.env['USERPROFILE'];
  if (home) add(pathMod!.join(home, 'Documents'));
  return out;
}

/** Папка лут-фильтров игры: <Documents>\My Games\Path of Exile 2 (injector.go:15-24). */
export function poe2GameDir(roots: readonly string[] = []): string | null {
  if (!HAS_DISK) return null;
  for (const docs of candidateDocumentsDirs(roots)) {
    const dir = pathMod!.join(docs, 'My Games', 'Path of Exile 2');
    if (fsMod!.existsSync(dir) && fsMod!.statSync(dir).isDirectory()) return dir;
  }
  return null;
}

/**
 * WriteFileAtomic: только temp+rename — ни при каких условиях игра не видит
 * полу-записанный фильтр (injector.go:93-101 + §6.4 плана).
 */
export function writeFilterAtomic(destPath: string, content: string): void {
  if (!HAS_DISK) throw new Error('livefilter: запись на диск недоступна вне Node');
  const tmp = `${destPath}.tmp-${Date.now()}`;
  fsMod!.writeFileSync(tmp, content, 'utf8');
  fsMod!.renameSync(tmp, destPath);
}

export interface WriteLiveFilterParams {
  /** Базовый NS-файл (читается только ради вставки). */
  basePath: string;
  /** Куда писать итог (<gameDir>\<name>.filter). */
  destPath: string;
  /** Готовый динамический блок (ЗНАЧЕНИЯ УЖЕ-selfchecked). */
  dynamicBlock: string;
}

/** Прочитать базу → инжект → атомарная запись. Возвращает число строк итога. */
export function writeLiveFilter(p: WriteLiveFilterParams): number {
  const base = fsMod!.readFileSync(p.basePath, 'utf8');
  const content = injectBlock(base, p.dynamicBlock);
  writeFilterAtomic(p.destPath, content);
  return content.split('\n').length;
}

// ─── Полный чистый пайплайн (без диска/сети) ──────────────────────────────

import { generateDynamicBlock, type LiveFilterConfig, type LiveFilterSnapshot, type LiveFilterStats } from './rules.js';
import { knownSetsFromBaseFilter, selfCheckBlock, type SelfCheckResult } from './selfcheck.js';

export interface ComposedLiveFilter {
  /** Итоговое содержимое <name>.filter (база + динамический блок). */
  content: string;
  stats: LiveFilterStats;
  selfCheck: SelfCheckResult | null;
  /** Динамический блок после SelfCheck (для логов/аудита). */
  dynamicBlock: string;
}

/**
 * Собрать полный фильтр: генерация правил по снапшоту → known-sets из базового
 * NS → SelfCheck (unknown-значения вырезаны ДО записи) → инжект. Чистая
 * функция — диск/сеть отдельно.
 */
export function composeLiveFilter(baseContent: string, snapshot: LiveFilterSnapshot, cfg: LiveFilterConfig): ComposedLiveFilter {
  const known = knownSetsFromBaseFilter(baseContent);
  // Генератору — КАНОНИЧЕСКИЙ регистр имён ('Amulets', 'Divine Orb'):
  // lowercase-ключи резали gear-hide и divine-spotlight до SelfCheck
  // (KnownFilterSets — canonical-case по контракту rules.ts).
  const gen = generateDynamicBlock(snapshot, cfg, {
    classes: known.classesCanonical,
    bases: new Set(known.bases.values()),
  });
  const checked = selfCheckBlock(gen.text, {
    classes: known.classes,
    bases: known.bases,
    loose: known.loose,
  });
  const dynamicBlock = checked.block ?? gen.text; // null = порог качества не достигнут, проверка выключена
  return {
    content: injectBlock(baseContent, dynamicBlock),
    stats: gen.stats,
    selfCheck: checked.block === null ? null : checked,
    dynamicBlock,
  };
}
