/**
 * Stat-id матчинг по тексту мода — конкурентное лечение патч-болей S7 (№183).
 *
 * Боль: каждый патч GGG меняет stat-id (и иногда тексты) в catalog
 * /api/trade2/data/stats — матчинг «текст мода рара → stat_id» ломался и
 * держался на ручном learn-журнале до выпуска фикса.
 *
 * Лечение — три контура (синтез Exiled-Exchange-2 + Sidekick, оба MIT;
 * приёмы reimplement, не copy — см. отчеты КУБ-3):
 *   1. Оффлайн-дамп живого API: data/game/trade/trade_stats.json — свежий
 *      слепок официального каталога (refresh: scripts/fetch-trade-stats.mjs).
 *      Instant-lookup по нормализованному тексту, без сети.
 *   2. Live-fallback (ExE2 TradeData.ts:52-95): при промахе в дампе — ОДИН
 *      живой запрос GET /api/trade2/data/stats (кэш + rate-limit our-http,
 *      результат мемоизируется). Чинит свежий патч без релиза.
 *   3. Learn-библиотека (learnedStats.ts) — последний офлайн-слой уверенности.
 *
 * Placeholder-матчер (ExE2 stat-translations.ts:76-224, минимальный набор):
 *   - нормализация: trim, lower, collapse пробелов;
 *   - числа → '#': кандидаты «все числа → #» + «одно число оставить, rest → #»
 *     (перебор комбинаций ограничен: k ≤ 4 чисел, k+1 кандидатов — не весь
 *     зоопарк ExE2 с 2/4-слойными скобочными баундсами — нашим потребителем
 *     (клир-текст игры) скобочные баунды не встречаются);
 *   - negate-варианты: «reduced» → «increased» (каталог хранит reduced-роллы
 *     как increased с отрицательным значением), знак числа срезается в '#';
 *   - legacy-скобки: суффикс «(legacy)» вырезается с обеих сторон матча.
 *
 * Unknown-handling (Sidekick StatParser.cs:96-175, HasTradeSupport):
 *   каждый стат размечается trade-ready | text-only; полный промах —
 *   Result-совместимый err(parse) с payload.unknown (список нераспознанных).
 *
 * Этап 2 (№246, находка EU-ресёрча — дайджест poe2_eu_digest_2026-10.md
 * §2.1 п.7): торговый UI в DE/FR/PT-клиентах отдаёт СМЕСЬ EN и
 * локализованных строк, FR-текст длиннее EN на ~25% (обрезки), один термин
 * переведён двумя способами ⇒ stat-id закреплён как ПЕРВИЧНЫЙ ключ
 * матчинга (MatchStrategy='stat-id', дефолт): если у входа известен stat-id
 * (item-API GGG / датасет), матчим по нему; текст — фолбэк с пометкой
 * matchedBy: 'stat-id' | 'text'. Текст-фолбэк расширен i18n-алиасами
 * (data/game/i18n/aliases.json): локализованный термин в строке НЕ
 * заменяется, а добавляет ДОПОЛНИТЕЛЬНЫЙ кандидат с EN-термином — родные
 * кандидаты сохраняют приоритет.
 *
 * Слой аддитивный: публичный API trade.ts (matchStatFilter и др.) не меняется.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';
import { cachedJson, DEFAULT_TTLS } from './cache.js';
import { getLearnedStatTemplates } from './learnedStats.js';
import { getI18nTermAliases, I18N_ALIAS_LANGS } from './i18nAliases.js';
import { err, ok, type Result } from './result.js';

/** Копия константы trade2 (без импорта trade.js — тот зависит от нас). */
const TRADE_API = 'https://www.pathofexile.com/api/trade2';

// ────────────────────────────────────────────────
// Типы
// ────────────────────────────────────────────────

/** Запись каталога статов (та же форма, что TradeStatEntry из trade.ts). */
export interface StatCatalogEntry {
  id: string;
  text: string;
  /** Группа каталога: explicit / implicit / pseudo / crafted / … */
  type?: string;
}

/** Откуда сматчился stat-id. */
export type StatMatchSource = 'offline' | 'live' | 'unknown';

/** Ключ матча (Этап 2, №246): 'stat-id' — первичный, 'text' — фолбэк.
 *  Этап 3 (Sidekick StatParser-паттерн): 'multi-line' — склейка соседних
 *  строк одного мода (Adapted from Sidekick-Poe/Sidekick, MIT);
 *  'fuzzy' — спасено лёгким нечётким сравнением (опечатки/склонения). */
export type MatchedBy = 'stat-id' | 'text' | 'multi-line' | 'fuzzy';

/** Стратегия матчинга пользовательской строки:
 *  - 'stat-id' (дефолт): если у входа известен stat-id — матчить по нему
 *    первично, текст — фолбэк (инструкция EU-находки: текст вне EN
 *    ненадёжен — смеси EN/локали, FR-обрезки, дубль-переводы);
 *  - 'text': форсировать текст-путь (id известного входа не используется
 *    для решения) — поведение слоя до №246.
 *  Для голых строк (без id) стратегии эквивалентны — как раньше. */
export type MatchStrategy = 'stat-id' | 'text';

/** Вход bulk-матчинга: голая строка (все текущие вызовы, ItemMod.text) либо
 *  объект с известным stat-id (из item-API GGG / датасета, где у стата есть id). */
export type StatMatchInput = string | { text: string; id?: string | null };

/** Результат матчинга одного стата; id === null → не распознан нигде. */
export interface StatMatch {
  id: string | null;
  source: StatMatchSource;
  /** Исходный текст мода (echo для UI/журналов). */
  text: string;
  /** Чем сматчились: stat-id (первичный ключ) или текст (фолбэк). */
  matchedBy?: MatchedBy;
  /** Нижняя граница значения (max × 0.9 — паритет с matchStatFilter в trade.ts).
   *  undefined: стат без чисел, negate-вариант или текст обрезан (FR-кейс) —
   *  stat-id-матч при этом остаётся валидным. */
  min?: number;
  /** Шаблон каталога, с которым сматчились (отладка/diff). */
  matchedText?: string;
  /** Multi-line (Sidekick StatParser.cs:96-113): матч получен склейкой
   *  соседних строк одного мода — здесь текст строк, вошедших в склейку
   *  (без primary-строки). Adapted from Sidekick-Poe/Sidekick (MIT). */
  mergedFrom?: string[];
}

/** per-stat разметка HasTradeSupport (Sidekick-паттерн): trade-ready | text-only. */
export interface StatMatchBulkItem {
  text: string;
  match: StatMatch;
  /** true = stat-id найден, фильтр trade2 строится (trade-ready). */
  tradeReady: boolean;
  /** Multi-line: index входа-строки, к которой ЭТА строка приклеена
   *  (second half мода). Такая строка не строит отдельный фильтр —
   *  фильтр строит primary (mergedInto-цель). */
  mergedInto?: number;
}

/** Счётчики прозрачности (Этап 3): UI/агент видит факты, а не null.
 *  Инвариант: matched + unrecognized = количество входов строки
 *  (second half склейки считается matched — она часть распознанного мода). */
export interface StatMatchingCounts {
  /** Входов, чей stat-id определён (включая склеенные половины). */
  matched: number;
  /** Строк, не сматченных одиночным проходом (спасены glue/fuzzy или unknown)
   *  — мера загрузки фолбэк-контуров. */
  unmatchedStatic: number;
  /** Primary-матчей, из которых строится trade2-фильтр (склеенные
   *  вторые строки не в счёт — фильтр один на весь мод). */
  tradeReady: number;
  /** Primary-матчи по ТЕКСТУ ('text' | 'multi-line' | 'fuzzy'), не по
   *  stat-id: id входа не был известен/не сработал — доверие ниже. */
  textOnly: number;
  /** Нераспознанные строки (=== payload.unknown.length). */
  unrecognized: number;
}

/** Итог матчинга списка статов. unknown = то, что неparsed нигде. */
export interface StatMatchingPayload {
  matches: StatMatchBulkItem[];
  unknown: string[];
  offlineMatches: number;
  liveMatches: number;
  /** Прозрачность (Этап 3): per-stat факты матчинга для UI/агентов. */
  counts: StatMatchingCounts;
  /** true = матчинг работал по деградировавшим данным (протухший дамп
   *  при недоступном live и т.п.) — НЕ ошибка, но результат менее
   *  надёжен; причина — в degradedReason. */
  degraded?: boolean;
  degradedReason?: string;
}

/** Result-совместимый исход с payload В ЛЮБОМ случае (ok и err). */
export type StatMatchingResult = Result<StatMatchingPayload> & { payload: StatMatchingPayload };

export interface StatMatchOptions {
  /** Полная подмена оффлайн-каталога (тесты; заменяет дамп + learned). */
  offlineEntries?: StatCatalogEntry[];
  /** Дополнительные офлайн-шаблоны поверх датасета (learn-журнал — trade.ts). */
  extraOfflineEntries?: StatCatalogEntry[];
  /** Injectable живой fetch каталога (тесты: без реальной сети). */
  fetchLive?: () => Promise<StatCatalogEntry[]>;
  /** Запретить live-фолбэк (оффлайн-_only контекст/тесты). */
  noLive?: boolean;
  /** Предпочтительная группа при множественном совпадении (explicit). */
  preferredType?: string;
  /** Стратегия матчинга (Этап 2, №246): 'stat-id' — id-первичный (дефолт),
   *  'text' — только текст (как до №246). Для входов без id не различается. */
  strategy?: MatchStrategy;
}

// ────────────────────────────────────────────────
// Нормализация и кандидаты (ExE2-минимум)
// ────────────────────────────────────────────────

function normalizeStatText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Вырезать «(legacy)»-суффикс — запасной вариант матчинга (ExE2 legacy-роллы). */
function stripLegacy(s: string): string {
  return s.replace(/\s*\(legacy\)\s*$/i, '').trim();
}

/** Число с опциональным знаком (знак срезается при замене на '#'). */
const NUM_RE = /[-+]?\d+(?:\.\d+)?/g;

// ────────────────────────────────────────────────
// I18n-алиасы (Этап 2, №246): расширение множества вариантов текст-фолбэка
// ────────────────────────────────────────────────

/** Правило подстановки: локализованный термин (lower) → EN-термин (lower). */
interface AliasRule {
  alias: string;
  en: string;
}

let aliasRulesCache: AliasRule[] | null = null;

/** Скомпилированные правила: все локали всех терминов aliases.json.
 *  Длинные первым проходом — иначе «Simulakrum» съест «Simulakrum-Splitter». */
function getAliasRules(): AliasRule[] {
  if (aliasRulesCache) return aliasRulesCache;
  const rules: AliasRule[] = [];
  for (const t of getI18nTermAliases()) {
    const en = t.en.trim().toLowerCase();
    if (!en) continue;
    for (const lang of I18N_ALIAS_LANGS) {
      for (const a of t[lang] ?? []) {
        const alias = a.trim().toLowerCase();
        if (alias && alias !== en) rules.push({ alias, en });
      }
    }
  }
  rules.sort((x, y) => y.alias.length - x.alias.length);
  aliasRulesCache = rules;
  return rules;
}

/** Буква/цифра? \b в JS-regex ASCII-only (не видит «Делириум»,
 *  «téléportation»), поэтому границы фраз проверяем посимвольно. */
function isWordChar(ch: string): boolean {
  return /\p{L}|\p{Nd}/u.test(ch);
}

/** Заменить все вхождения фразы с проверкой «границ слова». Возвращает
 *  исходную строку, если вхождений с корректными границами нет. */
function replaceWholePhrase(s: string, phrase: string, replacement: string): string {
  if (!phrase || !s.includes(phrase)) return s;
  let out = '';
  let idx = 0;
  let changed = false;
  while (idx < s.length) {
    const j = s.indexOf(phrase, idx);
    if (j < 0) {
      out += s.slice(idx);
      break;
    }
    const end = j + phrase.length;
    const prevOk = j === 0 || !isWordChar(s[j - 1]!);
    const nextOk = end >= s.length || !isWordChar(s[end]!);
    if (prevOk && nextOk) {
      out += s.slice(idx, j) + replacement;
      changed = true;
    } else {
      out += s.slice(idx, end);
    }
    idx = end;
  }
  return changed ? out : s;
}

/**
 * Дополнительный ключ-вариант с EN-терминами вместо локализованных (все
 * распознанные алиасы заменяются за один проход, порядок — длинные первыми).
 * Пусто = локализованных терминов в строке нет. Родной ключ НЕ удаляется —
 * это расширенное множество вариантов, а не подмена строки.
 */
function aliasVariantKeys(key: string): string[] {
  let v = key;
  for (const rule of getAliasRules()) {
    v = replaceWholePhrase(v, rule.alias, rule.en);
  }
  return v !== key ? [v] : [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Candidate {
  key: string;
  /** Кандидат получен swap-ом «reduced»→«increased» (semantics отриц. ролла). */
  negated: boolean;
}

/**
 * Кандидаты-ключи для lookup текста стата в индексе каталога, по приоритету:
 *   1. нормализованный текст как есть (точный матч, включая числа);
 *   2. все числа → '#';
 *   3. «одно число оставить, остальные → '#'» (комбинации, k ≤ 4);
 *   4. то же с swap-ом reduced→increased и/или вырезанным «(legacy)».
 * Порядок гарантирует, что родной шаблон каталога бьёт swap-вариант.
 */
function makeCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (key: string, negated: boolean): void => {
    const k = key.trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ key: k, negated });
  };

  for (const base of new Set([normalizeStatText(text), stripLegacy(normalizeStatText(text))])) {
    for (const negated of [false, true]) {
      const s = negated ? base.replace(/\breduced\b/g, 'increased') : base;
      if (negated && s === base) continue; // swap нечего менять — дубль варианта
      push(s, negated);
      // Все числа → '#' (знак срезается: «-15% …» и «+15% …» → «#% …»)
      push(s.replace(NUM_RE, '#'), negated);
      // Комбинации «оставить одно число»: шаблоны каталога с литеральными числами
      const nums = [...s.matchAll(new RegExp(NUM_RE.source, 'g'))];
      if (nums.length >= 2 && nums.length <= 4) {
        for (let i = 0; i < nums.length; i++) {
          let variant = '';
          let last = 0;
          for (let j = 0; j < nums.length; j++) {
            const m = nums[j]!;
            variant += s.slice(last, m.index);
            variant += i === j ? m[0] : '#';
            last = (m.index ?? 0) + m[0].length;
          }
          variant += s.slice(last);
          push(variant, negated);
        }
      }
    }
  }
  // Этап 2 (№246): i18n-варианты — строго ПОСЛЕ родных кандидатов: родной
  // шаблон каталога всегда бьёт алиас-вариант, алиасы работают только на
  // промахе родных ключей (зона text-фолбэка, вне EN-клиента).
  const natives = out.slice();
  for (const c of natives) {
    for (const v of aliasVariantKeys(c.key)) push(v, c.negated);
  }
  return out;
}

/** Индекс каталога: нормализованный шаблон ('#' внутри) → записи каталога. */
type CatalogIndex = Map<string, StatCatalogEntry[]>;

/** Каталог слоя: текстовый индекс (фолбэк) + прямой индекс по stat-id
 *  (первичный ключ, Этап 2 №246). */
interface Catalog {
  byText: CatalogIndex;
  byId: Map<string, StatCatalogEntry>;
}

function buildCatalog(entries: StatCatalogEntry[]): Catalog {
  const index: CatalogIndex = new Map();
  const byId = new Map<string, StatCatalogEntry>();
  for (const e of entries) {
    if (!e || typeof e.id !== 'string' || typeof e.text !== 'string' || !e.text) continue;
    // Первый id в порядке слоя побеждает (дамп → learned): для byId
    // репрезентативен оригинал каталога, не learn-дубликат.
    if (!byId.has(e.id)) byId.set(e.id, e);
    const n = normalizeStatText(e.text);
    if (!n) continue;
    for (const key of new Set([n, stripLegacy(n)])) {
      const bucket = index.get(key);
      if (bucket) bucket.push(e);
      else index.set(key, [e]);
    }
  }
  return { byText: index, byId };
}

/** Запись каталога по stat-id (первичный ключ). null = id слою неизвестен. */
function findById(catalog: Catalog, id: string): StatCatalogEntry | null {
  return catalog.byId.get(id) ?? null;
}

/** Лучший кандидат из совпавших по одному ключу: длиннейший текст, затем
 *  предпочтительная группа (explicit перед pseudo/implicit при равном тексте —
 *  для trade-фильтров explicit-модов это правильный id). */
function pickBest(entries: StatCatalogEntry[], preferredType?: string): StatCatalogEntry {
  let best = entries[0]!;
  for (const e of entries) {
    const bl = normalizeStatText(best.text).length;
    const el = normalizeStatText(e.text).length;
    if (el > bl) {
      best = e;
    } else if (el === bl) {
      const bestPrefers = preferredType && best.type === preferredType;
      const ePrefers = preferredType && e.type === preferredType;
      if (ePrefers && !bestPrefers) best = e;
    }
  }
  return best;
}

/** Ролл из шаблона: числа в позициях '#' → { min } (max × 0.9, паритет trade.ts). */
function extractMin(entryText: string, normText: string): number | undefined {
  const template = normalizeStatText(entryText);
  if (!template.includes('#')) return undefined;
  const pattern = '^' + escapeRegExp(template).replace(/#/g, '([+-]?\\d+(?:\\.\\d+)?)') + '$';
  let m: RegExpExecArray | null = null;
  try {
    m = new RegExp(pattern).exec(normText) ?? new RegExp(pattern).exec(stripLegacy(normText));
  } catch {
    return undefined;
  }
  if (!m) return undefined;
  const values = m.slice(1).map(Number).filter((v) => Number.isFinite(v));
  if (!values.length) return undefined;
  return Math.max(...values) * 0.9;
}

interface FoundEntry {
  entry: StatCatalogEntry;
  negated: boolean;
}

function findInIndex(
  index: CatalogIndex,
  text: string,
  preferredType?: string,
): FoundEntry | null {
  const candidates = makeCandidates(text);
  for (const c of candidates) {
    const bucket = index.get(c.key);
    if (bucket && bucket.length) {
      return { entry: pickBest(bucket, preferredType), negated: c.negated };
    }
  }
  return null;
}

// ────────────────────────────────────────────────
// Fuzzy-дизамбиг (Этап 3): лёгкий нечёткий матч как ПОСЛЕДНИЙ text-тир,
// до honest-unknown. Числа → '#' сравниваются строго (ролл не фаззим),
// слова — по Levenshtein ≤ len/8 (паттерн xiletrade). Скор — Dice по
// токенам: 2·common/(|q|+|t|), порог 0.85 = максимум одна «шумная»
// разница на ~5+ токенов. Почему токены, а не голый Levenshtein: строки
// статов длинные, вставка/потеря слова (обрезки, переводы) слабо бьёт
// дистанцию, но сильно меняет смысл — токен-подход это ловит, а
// per-token len/8 внутри токена ловит опечатки/склонения.
// Adapted from Sidekick-Poe/Sidekick (StatParser scoring, MIT).
// ────────────────────────────────────────────────

const FUZZY_MIN_SCORE = 0.85;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m + n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]!;
}

/** Токены равны «достаточно»? '#' (числовой слот) — только строгое равенство. */
function tokenFuzzyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === '#' || b === '#') return false;
  const tol = Math.max(1, Math.floor(Math.min(a.length, b.length) / 8));
  return Math.abs(a.length - b.length) <= tol && levenshtein(a, b) <= tol;
}

/** Dice-коэффициент по мультимножеству токенов (0..1). */
function fuzzyScoreKeys(queryKey: string, indexKey: string): number {
  const q = queryKey.split(' ');
  const t = indexKey.split(' ');
  if (Math.abs(q.length - t.length) > 1) return 0; // вставка/удаление ≤ 1 слова
  let common = 0;
  const used = new Array<boolean>(t.length).fill(false);
  for (const qt of q) {
    for (let j = 0; j < t.length; j++) {
      if (!used[j] && tokenFuzzyEqual(qt, t[j]!)) {
        used[j] = true;
        common++;
        break;
      }
    }
  }
  return (2 * common) / (q.length + t.length);
}

/** Последний text-тир: скан всех ключей каталога, best-скор (Sidekick
 *  StatParser.cs:71-110: best line-count → best score → длиннейший шаблон). */
function findFuzzyInIndex(
  index: CatalogIndex,
  text: string,
  preferredType?: string,
): { found: FoundEntry } | null {
  const norm = normalizeStatText(text);
  const key = norm.replace(NUM_RE, '#');
  if (!key || !key.includes(' ')) return null; // однотокенные строки не фаззим
  const queryKeys = [...new Set([key, stripLegacy(key)])];
  let bestScore = 0;
  let bestBucket: StatCatalogEntry[] | null = null;
  for (const [k, bucket] of index) {
    if (!bucket.length) continue;
    let score = 0;
    for (const q of queryKeys) {
      score = Math.max(score, fuzzyScoreKeys(q, k));
      if (score >= 1) break;
    }
    // Финал по Sidekick-критерию: лучший скор, при равенстве — «охват
    // больше текста» (длиннейший ключ каталога, best line-count proxy).
    if (
      score >= FUZZY_MIN_SCORE &&
      (bestBucket === null ||
        score > bestScore ||
        (score === bestScore &&
          k.length > normalizeStatText(pickBest(bestBucket, preferredType).text).length))
    ) {
      bestScore = score;
      bestBucket = bucket;
    }
  }
  if (!bestBucket) return null;
  return { found: { entry: pickBest(bestBucket, preferredType), negated: false } };
}

// ────────────────────────────────────────────────
// Оффлайн-слой: свежий дамп каталога + learn-библиотека
// ────────────────────────────────────────────────

interface TradeStatsFile {
  _meta?: { source?: string; fetchedAt?: string; entries?: number };
  result?: Array<{ id?: string; label?: string; entries?: Array<{ id?: string; text?: string; type?: string }> }>;
}

function tradeStatsPath(): string {
  return pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'trade',
    'trade_stats.json',
  );
}

/** Свежесть дампа → live-first после этого порога (протухший дамп не
 *  должен затирать правду живого каталога). */
const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000;

let offlineCache: { index: Catalog; entries: number; fetchedAt: number | null } | null = null;

function getOfflineIndex(): { index: Catalog; entries: number; fetchedAt: number | null } {
  if (offlineCache) return offlineCache;
  let entries: StatCatalogEntry[] = [];
  let fetchedAt: number | null = null;
  if (HAS_DISK) {
    try {
      const raw = JSON.parse(fsMod!.readFileSync(tradeStatsPath(), 'utf8')) as TradeStatsFile;
      for (const group of raw.result ?? []) {
        for (const e of group.entries ?? []) {
          if (typeof e.id === 'string' && typeof e.text === 'string') {
            entries.push({ id: e.id, text: e.text, type: group.id ?? e.type });
          }
        }
      }
      fetchedAt = raw._meta?.fetchedAt ? Date.parse(raw._meta.fetchedAt) : null;
      if (!Number.isFinite(fetchedAt as number)) fetchedAt = null;
    } catch {
      entries = [];
    }
  }
  // Learn-библиотека — последний офлайн-слой уверенности (см. learnedStats.ts)
  entries = entries.concat(getLearnedStatTemplates() as StatCatalogEntry[]);
  offlineCache = { index: buildCatalog(entries), entries: entries.length, fetchedAt };
  return offlineCache;
}

// ────────────────────────────────────────────────
// Live-fallback: один живой запрос, мемоизация, negative-memo
// ────────────────────────────────────────────────

const LIVE_FAIL_RETRY_MS = 5 * 60 * 1000;

const liveState: {
  fetcher: (() => Promise<StatCatalogEntry[]>) | null;
  ok: Catalog | null;
  failedAt: number;
} = { fetcher: null, ok: null, failedAt: 0 };

/** Дефолтный живой fetch: кэш-disk our-http (TTL репо-класса, stale-if-error),
 *  rate-limit хоста — как у fetchTradeStats() в trade.ts. */
async function defaultFetchLive(): Promise<StatCatalogEntry[]> {
  const { data } = await cachedJson<{ result?: Array<{ id?: string; entries?: Array<{ id?: string; text?: string }> }> }>(
    `${TRADE_API}/data/stats`,
    { ttlMs: DEFAULT_TTLS.repoe },
  );
  const out: StatCatalogEntry[] = [];
  for (const group of data.result ?? []) {
    for (const e of group.entries ?? []) {
      if (typeof e.id === 'string' && typeof e.text === 'string') {
        out.push({ id: e.id, text: e.text, type: group.id });
      }
    }
  }
  if (!out.length) throw new Error('trade2/data/stats: empty catalog');
  return out;
}

/**
 * Живой каталог с мемоизацией: success кэшится навсегда (до reset), fail — на
 * 5 минут (negative-memo: прайс-чек не должен долбить лежащий API на каждый стат).
 * Мемоизация привязана к функции-fetcher: подмена fetcher (тесты) сбрасывает её.
 */
async function getLiveIndex(opts: StatMatchOptions): Promise<Catalog | null> {
  if (opts.noLive) return null;
  const fetcher = opts.fetchLive ?? defaultFetchLive;
  if (liveState.fetcher === fetcher) {
    if (liveState.ok) return liveState.ok;
    if (Date.now() - liveState.failedAt < LIVE_FAIL_RETRY_MS) return null;
  }
  liveState.fetcher = fetcher;
  try {
    const entries = await fetcher();
    liveState.ok = buildCatalog(entries);
    liveState.failedAt = 0;
    return liveState.ok;
  } catch {
    liveState.ok = null;
    liveState.failedAt = Date.now();
    return null;
  }
}

/** Сброс кэшей слоя (тесты/самодиагностика). */
export function resetStatMatchingCaches(): void {
  offlineCache = null;
  liveState.fetcher = null;
  liveState.ok = null;
  liveState.failedAt = 0;
  aliasRulesCache = null; // №246: перечитать aliases.json (тесты/патч данных)
}

// ────────────────────────────────────────────────
// Публичный API
// ────────────────────────────────────────────────

function toStatMatch(
  found: FoundEntry | null,
  text: string,
  source: StatMatchSource,
  preferredType?: string,
  matchedBy: MatchedBy = 'text',
): StatMatch {
  if (!found) return { id: null, source: 'unknown', text };
  const normText = normalizeStatText(text);
  const min = found.negated ? undefined : extractMin(found.entry.text, normText);
  return {
    id: found.entry.id,
    source,
    text,
    matchedBy,
    ...(min !== undefined ? { min } : {}),
    matchedText: found.entry.text,
  };
}

/**
 * Матчинг ОДНОГО стата: текст (или {text, id}) → { id, source, matchedBy }.
 * Порядок слоёв: свежий оффлайн-дамп → живой fallback → unknown;
 * протухший дамп (>45 дней) → сначала живой, дамп как фолбэк.
 * При известном stat-id и стратегии 'stat-id' (дефолт) — id-матч первичен
 * в каждом слое, текст — фолбэк (Этап 2, №246).
 */
export async function matchStat(
  text: StatMatchInput,
  opts: StatMatchOptions = {},
): Promise<StatMatch> {
  const { matches } = await matchStatsBulk([text], opts);
  return matches[0]?.match ?? { id: null, source: 'unknown', text: typeof text === 'string' ? text : text.text };
}

/**
 * Bulk-матчинг: список статов (текст или {text, id}) → per-stat разметка
 * HasTradeSupport (Sidekick-паттерн): каждый стат trade-ready | text-only.
 * Живой каталог тянется максимум ОДИН раз на вызов (и мемоизируется).
 *
 * Этап 2 (№246): при известном stat-id (вход-объект) и дефолтной стратегии
 * 'stat-id' матч идёт по id первично в каждом слое — локализованный/обрезанный
 * текст (DE-смеси, FR-обрезки) не влияет на результат. Текст — фолбэк
 * (matchedBy: 'text'), расширенный i18n-алиасами.
 *
 * Этап 3 (Sidekick StatParser-паттерн, adapted from Sidekick-Poe/Sidekick,
 * MIT — StatParser.cs:96-113): три прохода на вызов:
 *   1. exact: одиночные строки по слоям (fresh dump → live; stale — обратно);
 *   2. multi-line glue: пары соседних СТРОК-входов, где вторая (или обе)
 *      не сматчились, пробуются конкатенацией с единым пробелом — так
 *      лечатся обёрнутые игрой длинные моды (одна строка в клире PoE2 —
 *      два line в буфере/UI). Приоритет — best line-count (Sidekick
 *      StatParser.cs:71-72,103-110): если пара вместе бьёт БОЛЕЕ длинный
 *      шаблон каталога, чем одиночный матч первой строки — выигрывает
 *      пара. Иначе одиночный матч сохраняется (синглы не ломаем).
 *   3. fuzzy: последняя надежда для оставшихся промахов (опечатки/склонения),
 *      matchedBy: 'fuzzy'.
 *
 * Прозрачность: payload.counts {matched, unmatchedStatic, tradeReady,
 * textOnly, unrecognized} + payload.unknown с ПОЛНЫМ текстом каждой
 * нераспознанной строки; payload.degraded=true + degradedReason — если
 * матчинг работал по протухшему дампу без live (или дамп отсутствовал).
 */
export async function matchStatsBulk(
  mods: StatMatchInput[],
  opts: StatMatchOptions = {},
): Promise<StatMatchingPayload> {
  const preferredType = opts.preferredType ?? 'explicit';
  const strategy: MatchStrategy = opts.strategy ?? 'stat-id';
  const injected = opts.offlineEntries !== undefined;
  let offline: Catalog;
  let offlineFresh = true;
  if (injected) {
    offline = buildCatalog([...opts.offlineEntries!, ...(opts.extraOfflineEntries ?? [])]);
  } else {
    const o = getOfflineIndex();
    offline = opts.extraOfflineEntries
      ? buildCatalog([...flattenIndex(o.index), ...opts.extraOfflineEntries])
      : o.index;
    // Протухший дамп (>45 дней): живой каталог правдивее — live-first.
    offlineFresh = !(o.fetchedAt && Date.now() - o.fetchedAt > STALE_AFTER_MS);
  }

  const liveNeeded = async (): Promise<Catalog | null> => getLiveIndex(opts);
  // Кэш индексов на вызов: live тянем лениво и не больше одного раза.
  let live: Catalog | null | undefined;
  const resolveLive = async (): Promise<Catalog | null> => {
    if (live === undefined) live = await liveNeeded();
    return live;
  };

  const isString = mods.map((m) => typeof m === 'string');
  const texts = mods.map((m) => (typeof m === 'string' ? m : m.text));
  const knownIds = mods.map((m) => (typeof m === 'string' ? null : m.id ?? null));

  const layerOrder: Array<'offline' | 'live'> = offlineFresh
    ? ['offline', 'live']
    : ['live', 'offline'];

  /** Точный lookup (stat-id первичен при стратегии) в ОДНОМ слое. */
  const lookupExact = (
    cat: Catalog,
    text: string,
    source: StatMatchSource,
    knownId: string | null,
  ): StatMatch | null => {
    const useStatId = strategy === 'stat-id' && !!knownId;
    if (useStatId) {
      const entry = findById(cat, knownId!);
      if (entry) {
        return toStatMatch({ entry, negated: false }, text, source, preferredType, 'stat-id');
      }
    }
    const found = findInIndex(cat.byText, text, preferredType);
    if (found) return toStatMatch(found, text, source, preferredType);
    return null;
  };

  /** Точный матч по слоям (fresh dump → live; stale — обратно). */
  const matchThroughLayers = async (
    text: string,
    knownId: string | null,
  ): Promise<StatMatch | null> => {
    for (const layer of layerOrder) {
      const cat = layer === 'offline' ? offline : await resolveLive();
      if (!cat) continue;
      const hit = lookupExact(cat, text, layer, knownId);
      if (hit) return hit;
    }
    return null;
  };

  // ── Проход 1: exact-матчинг каждой строки по слоям ──
  const matched: Array<StatMatch | null> = new Array<StatMatch | null>(mods.length).fill(null);
  let unmatchedStatic = 0;
  for (let i = 0; i < mods.length; i++) {
    const hit = await matchThroughLayers(texts[i]!, knownIds[i]!);
    matched[i] = hit;
    if (!hit) unmatchedStatic++;
  }

  // ── Проход 2: multi-line glue (Sidekick StatParser.cs:96-113) ──
  // Склейка пар соседних строк-входов: пробуем если вторая строка пары
  // не сматчилась (а первая — не сматчилась тоже ИЛИ её одиночный шаблон
  // короче склеенного: line-count приоритет Sidekick, синглы не ломаем).
  const mergedInto = new Array<number | undefined>(mods.length).fill(undefined);
  const mergedFrom: Array<string[] | undefined> = new Array<string[] | undefined>(
    mods.length,
  ).fill(undefined);
  for (let i = 0; i + 1 < mods.length; i++) {
    if (!isString[i] || !isString[i + 1]) continue; // id-входы склейке не подлежат
    if (mergedInto[i] !== undefined || mergedInto[i + 1] !== undefined) continue;
    if (matched[i + 1]) continue; // вторая строка сама сматчилась — не клеим
    const combined = `${texts[i]} ${texts[i + 1]}`;
    const combinedMatch = await matchThroughLayers(combined, null);
    if (!combinedMatch) continue;
    const singleTemplate = matched[i]?.matchedText ?? null;
    if (singleTemplate) {
      // Оба матча валидны: выигрывает big line-count (длиннейший шаблон
      // каталога покрывает больше строк — Sidekick best-line-count score).
      const singleLen = normalizeStatText(singleTemplate).length;
      const combinedLen = normalizeStatText(combinedMatch.matchedText ?? '').length;
      if (combinedLen <= singleLen) continue;
    }
    matched[i] = { ...combinedMatch, text: combined, matchedBy: 'multi-line', mergedFrom: [texts[i + 1]!] };
    matched[i + 1] = {
      ...combinedMatch,
      text: texts[i + 1]!,
      min: undefined,
      mergedFrom: undefined,
    };
    mergedInto[i + 1] = i;
    mergedFrom[i] = [texts[i + 1]!];
  }

  // ── Проход 3: fuzzy-дизамбиг для оставшихся промахов ──
  for (let i = 0; i < mods.length; i++) {
    if (matched[i] || !isString[i]) continue; // id-входы fuzzy не фаззим
    for (const layer of layerOrder) {
      const cat = layer === 'offline' ? offline : await resolveLive();
      if (!cat) continue;
      const fuzzy = findFuzzyInIndex(cat.byText, texts[i]!, preferredType);
      if (fuzzy) {
        matched[i] = toStatMatch(fuzzy.found, texts[i]!, layer, preferredType, 'fuzzy');
        break;
      }
    }
  }

  // ── Сборка payload: per-stat items, счётчики, degraded-диагностика ──
  const items: StatMatchBulkItem[] = [];
  const unknown: string[] = [];
  let offlineMatches = 0;
  let liveMatches = 0;
  let primary = 0;
  let textOnly = 0;
  for (let i = 0; i < mods.length; i++) {
    const m = matched[i]!;
    if (!m) {
      items.push({ text: texts[i]!, match: { id: null, source: 'unknown', text: texts[i]! }, tradeReady: false });
      unknown.push(texts[i]!);
      continue;
    }
    const isSecondary = mergedInto[i] !== undefined;
    items.push(
      isSecondary
        ? { text: texts[i]!, match: m, tradeReady: true, mergedInto: mergedInto[i] }
        : { text: texts[i]!, match: m, tradeReady: true },
    );
    if (!isSecondary) {
      primary++;
      if (m.matchedBy !== 'stat-id') textOnly++;
      if (m.source === 'offline') offlineMatches++;
      else if (m.source === 'live') liveMatches++;
    }
  }

  const payload: StatMatchingPayload = {
    matches: items,
    unknown,
    offlineMatches,
    liveMatches,
    counts: {
      matched: primary + mergedFrom.filter(Boolean).length,
      unmatchedStatic,
      tradeReady: primary,
      textOnly,
      unrecognized: unknown.length,
    },
  };

  // Degraded-диагностика (Этап 4): матчинг по протухшему/отсутствующему
  // дампу при недоступном live — не ошибка, но пользователь обязан это
  // видеть (раньше промах на stale-first уходил молча).
  if (!injected) {
    const liveUnavailable = opts.noLive || live === null;
    const usedStale = items.some((it) => it.match.source === 'offline');
    if (offlineFresh && liveUnavailable && getOfflineIndex().entries === 0) {
      payload.degraded = true;
      payload.degradedReason =
        'stat matching degraded: no trade-stats dump and live catalog unavailable';
    } else if (!offlineFresh && liveUnavailable) {
      payload.degraded = true;
      payload.degradedReason = opts.noLive
        ? 'stat matching degraded: trade-stats dump is stale (>45d) and live fallback disabled'
        : 'stat matching degraded: trade-stats dump is stale (>45d) and live catalog fetch failed; stale dump used as fallback';
    } else if (!offlineFresh && usedStale) {
      payload.degraded = true;
      payload.degradedReason =
        'stat matching degraded: stale trade-stats dump used as fallback (live catalog missing some stats)';
    }
  }

  return payload;
}

function flattenIndex(catalog: Catalog): StatCatalogEntry[] {
  const out: StatCatalogEntry[] = [];
  for (const bucket of catalog.byText.values()) out.push(...bucket);
  return out;
}

/**
 * Result-обёртка unknown-handling: полный промах всех статов — Result-совместимый
 * err(parse) (не ретраится: текст не belongs каталогу), список неизвестных — в
 * payload.unknown (материал для будущего UX «Not recognized → Reload»). Частичный
 * матч — ok с payload.unknown.
 */
export async function matchStatsBulkResult(
  mods: StatMatchInput[],
  opts: StatMatchOptions = {},
): Promise<StatMatchingResult> {
  const payload = await matchStatsBulk(mods, opts);
  const anyReady = payload.matches.some((m) => m.tradeReady);
  if (!anyReady) {
    const base = err('parse', `stat matching failed: unknown mods [${payload.unknown.join(' | ')}]`);
    return { ...base, payload };
  }
  return { ...ok(payload), payload };
}

/** Само-отчёт слоя (диагностика/тулы info): размеры и свежесть контуров. */
export function statMatchingInfo(): {
  offlineEntries: number;
  dumpFetchedAt: string | null;
  dumpStale: boolean;
  liveMemoized: boolean;
} {
  const o = getOfflineIndex();
  return {
    offlineEntries: o.entries,
    dumpFetchedAt: o.fetchedAt ? new Date(o.fetchedAt).toISOString() : null,
    dumpStale: !!(o.fetchedAt && Date.now() - o.fetchedAt > STALE_AFTER_MS),
    liveMemoized: liveState.ok !== null,
  };
}
