/**
 * «🛡 Радар» (Этап 4-2, №256): живые баги (known_issues.json) +
 * легальные хитрости (tricks.json) - data-словарь для web-вкладки
 * и MCP-тулов.
 *
 * Наследует дисциплину simulacrum.ts / patches.ts: файл - только
 * факты, курация ручная; unverified-записи не фильтруются, а
 * передаются с флагом (UI выводит пометку ❓).
 *
 * Загрузка - статические JSON-импорты `with {type:'json'}`
 * (конвенция №247/№248): файлы идут inline-в бандл core,
 * доступны и web-у, и MCP-клиенту без чтения с диска.
 */

import issuesFile from '../data/game/known_issues.json' with { type: 'json' };
import tricksFile from '../data/game/tricks.json' with { type: 'json' };

/** Статус записи: live - подтверждён 2+ источниками; unverified - ❓; fixed - исправлен; feature - фича-не-баг. */
export type IssueStatus = 'live' | 'unverified' | 'fixed' | 'feature';

/** Риск для игрока: none - безопасно знать/обходить; ban - связано с ToS-риском (в known_issues таковые только в fixed-архиве). */
export type IssueRisk = 'none' | 'grey' | 'ban';

/** Категория последствий для игрока. */
export type IssueSeverity =
  | 'progress-block' // карту/механику не завершить
  | 'progress-loss' // потеря лута/валюты/времени
  | 'loot' // влияет на лут
  | 'damage' // молча режет урон/баффы
  | 'perf' // производительность
  | 'exploit' // был эксплойтом (fixed-архив)
  | 'endgame-plan' // не баг: влияет на планирование эндгейма
  | 'perk-broken'
  | 'minor';

export interface KnownIssue {
  id: string;
  title: string;
  status: IssueStatus;
  severity?: IssueSeverity;
  /** Механизм: почему это происходит / что именно ломается. */
  mechanism: string;
  /** Воркараунд; пустая строка = его нет. */
  workaround?: string;
  risk?: IssueRisk;
  /** Патч, где исправлено (обязателен для status='fixed'). */
  fixed_in?: string;
  unverified?: string;
  report_dates?: string[];
  sources?: string[];
}

export interface KnownTrick {
  id: string;
  title: string;
  category?: string;
  mechanism: string;
  usage: string;
  risk?: IssueRisk;
  unverified?: string;
  status_note?: string;
  sources?: string[];
}

interface IssuesFile {
  _meta?: { patch?: string; as_of?: string; sources?: string[]; note?: string };
  issues?: KnownIssue[];
}

interface TricksFile {
  _meta?: { patch?: string; as_of?: string; sources?: string[]; note?: string };
  tricks?: KnownTrick[];
}

const ISSUE_STATUSES = new Set<IssueStatus>(['live', 'unverified', 'fixed', 'feature']);
const RISKS = new Set<IssueRisk>(['none', 'grey', 'ban']);

const SEVERITIES = new Set<IssueSeverity>([
  'progress-block', 'progress-loss', 'loot', 'damage', 'perf', 'exploit', 'endgame-plan', 'perk-broken', 'minor',
]);

function isIssue(raw: unknown): raw is KnownIssue {
  if (raw == null || typeof raw !== 'object') return false;
  const o = raw as Partial<KnownIssue>;
  if (
    !(typeof o.id === 'string' && o.id.trim().length > 0) ||
    typeof o.title !== 'string' ||
    !(typeof o.status === 'string' && ISSUE_STATUSES.has(o.status as IssueStatus)) ||
    typeof o.mechanism !== 'string'
  ) return false;
  if (o.risk != null && !(typeof o.risk === 'string' && RISKS.has(o.risk))) return false;
  if (o.severity != null && !(typeof o.severity === 'string' && SEVERITIES.has(o.severity as IssueSeverity))) return false;
  return true;
}

function isTrick(raw: unknown): raw is KnownTrick {
  if (raw == null || typeof raw !== 'object') return false;
  const o = raw as Partial<KnownTrick>;
  if (
    !(typeof o.id === 'string' && o.id.trim().length > 0) ||
    typeof o.title !== 'string' ||
    typeof o.mechanism !== 'string' ||
    typeof o.usage !== 'string'
  ) return false;
  if (o.risk != null && !(typeof o.risk === 'string' && RISKS.has(o.risk))) return false;
  return true;
}

/** Парсинг payload'а (тест/inline): мусор пропускаем, fixed без fixed_in - тоже (schema-ошибка курации). */
export function parseKnownIssues(raw: unknown): KnownIssue[] {
  if (!raw || typeof raw !== 'object') return [];
  const f = raw as IssuesFile;
  if (!Array.isArray(f.issues)) return [];
  return f.issues.filter((x): x is KnownIssue => {
    if (!isIssue(x)) return false;
    if (x.status === 'fixed' && !(typeof x.fixed_in === 'string' && x.fixed_in.length > 0)) return false;
    return true;
  });
}

export function parseKnownTricks(raw: unknown): KnownTrick[] {
  if (!raw || typeof raw !== 'object') return [];
  const f = raw as TricksFile;
  if (!Array.isArray(f.tricks)) return [];
  return f.tricks.filter(isTrick);
}

/** Полный список багов из data-файла (порядок файла = порядок курации). */
export function listKnownIssues(): KnownIssue[] {
  return parseKnownIssues(issuesFile);
}

export function listKnownTricks(): KnownTrick[] {
  return parseKnownTricks(tricksFile);
}

/** Живые (live) баги - главный экран «сейчас сломано». */
export function liveIssues(): KnownIssue[] {
  return listKnownIssues().filter((i) => i.status === 'live');
}

/** Фичи-не-баги - против паники «всё сломалось». */
export function featureIssues(): KnownIssue[] {
  return listKnownIssues().filter((i) => i.status === 'feature');
}

/** Архив исправленного (для секции «✅ Исправлено»). */
export function fixedIssues(): KnownIssue[] {
  return listKnownIssues().filter((i) => i.status === 'fixed');
}

/** ❓-записи (единичные репорты) - выводить с пометкой, не как факт. */
export function unconfirmedIssues(): KnownIssue[] {
  return listKnownIssues().filter((i) => i.status === 'unverified');
}

/** Поиск по id (deep-links/MCP-запросы «расскажи про X»). */
export function findIssue(id: string): KnownIssue | null {
  const k = id.trim();
  return listKnownIssues().find((i) => i.id === k) ?? null;
}

export function findTrick(id: string): KnownTrick | null {
  const k = id.trim();
  return listKnownTricks().find((t) => t.id === k) ?? null;
}

/** Мета data-файлов (self-describe для UI/тулов). */
export function radarMeta(): {
  patch: string | null;
  asOf: string | null;
  issuesTotal: number;
  issuesLive: number;
  issuesUnconfirmed: number;
  issuesFixed: number;
  issuesFeature: number;
  tricksTotal: number;
} {
  const all = listKnownIssues();
  return {
    patch: issuesFile._meta?.patch ?? null,
    asOf: issuesFile._meta?.as_of ?? null,
    issuesTotal: all.length,
    issuesLive: all.filter((i) => i.status === 'live').length,
    issuesUnconfirmed: all.filter((i) => i.status === 'unverified').length,
    issuesFixed: all.filter((i) => i.status === 'fixed').length,
    issuesFeature: all.filter((i) => i.status === 'feature').length,
    tricksTotal: listKnownTricks().length,
  };
}

export type { IssuesFile, TricksFile };
