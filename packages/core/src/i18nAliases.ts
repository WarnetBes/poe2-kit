/**
 * Локализационные алиасы терминов EN → {ru, de, fr, es, pt} (Этап 2, №246).
 *
 * Зачем: находка EU-ресёрча (дайджест _research/poe2_eu_digest_2026-10.md §2.1
 * п.7): торговый UI в DE/FR/PT-клиентах отдаёт СМЕСЬ EN и локализованных
 * строк, FR-текст длиннее EN на ~25% (обрезки), один термин переведён
 * двумя способами ⇒ текст-матчинг пользовательского ввода ненадёжен вне
 * EN-клиента. Первичный ключ матчинга — stat-id (см. statMatching.ts);
 * алиасы расширяют допустимое множество вариантов текст-фолбэка.
 *
 * Данные: data/game/i18n/aliases.json — только термины, подтверждённые
 * дайджестами (EU §2 + RU §1.2, poe2db = официальные строки GGG,
 * проверено 09.10.2026); каждый термин помечен _meta {patch, sources}.
 * Отсутствие языкового ключа = термин не переведён в этой локали —
 * пустоты НЕ заполняются выдуманными переводами.
 *
 * Безопасность: файл — ТОЛЬКО данные (JSON), читается через JSON.parse
 * и никогда не исполняется (см. SECURITY.md).
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

/** Языковые ключи алиасов (внутриигровые локали без EN — он базовый). */
export const I18N_ALIAS_LANGS = ['ru', 'de', 'fr', 'es', 'pt'] as const;

export type I18nAliasLang = (typeof I18N_ALIAS_LANGS)[number];

/** Один термин: EN-канон + списки локализованных вариантов (несколько =
 *  дубль-термины вроде Shrine → «Святыня»/«Алтарь»). */
export interface I18nTermAliases {
  en: string;
  ru?: string[];
  de?: string[];
  fr?: string[];
  es?: string[];
  pt?: string[];
}

export interface I18nAliasesFile {
  _meta?: { patch?: string; collectedAt?: string; sources?: string[]; note?: string };
  terms?: I18nTermAliases[];
}

function aliasesPath(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'i18n',
    'aliases.json',
  );
}

let cache: { raw: I18nAliasesFile; terms: I18nTermAliases[] } | null = null;

function load(): { raw: I18nAliasesFile; terms: I18nTermAliases[] } {
  const empty: I18nAliasesFile = {};
  if (!HAS_DISK) return { raw: empty, terms: [] };
  if (cache) return cache;
  try {
    const raw = JSON.parse(fsMod!.readFileSync(aliasesPath(), 'utf8')) as I18nAliasesFile;
    const terms = (raw.terms ?? []).filter(
      (t) => t && typeof t.en === 'string' && t.en.trim().length > 0,
    );
    cache = { raw, terms };
    return cache;
  } catch {
    return { raw: empty, terms: [] };
  }
}

/**
 * Все термины-алиасы (офлайн, из data-файла; в браузере/без диска — пусто,
 * есть только EN-текст-путь). Порядок — как в файле.
 */
export function getI18nTermAliases(): I18nTermAliases[] {
  return load().terms;
}

/** Патч-мета файла (для диагностики/само-отчёта). */
export function i18nAliasesMeta(): {
  patch: string | null;
  collectedAt: string | null;
  terms: number;
  languages: string[];
} {
  const { raw, terms } = load();
  const langs = new Set<string>();
  for (const t of terms) {
    for (const lang of I18N_ALIAS_LANGS) {
      if ((t[lang] ?? []).length) langs.add(lang);
    }
  }
  return {
    patch: raw._meta?.patch ?? null,
    collectedAt: raw._meta?.collectedAt ?? null,
    terms: terms.length,
    languages: [...langs].sort(),
  };
}

/** Сброс кэша (тесты: refresh-имитация патча данных). */
export function resetI18nAliasesCache(): void {
  cache = null;
}
