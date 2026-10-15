/**
 * «🧬 Стартовые» (overlay-панель стартовых билдов, волна №479): компактификатор
 * датасета starterBuildGuides для запекания в rendererHtml JSON-инжектом
 * (паттерн №262 RADAR_LIVE: ноль IPC на данные, ноль сети, офлайн-вкладка).
 *
 * Полный датасет 89.9 КБ в оверлей НЕ тащим: гайд-контент — RU by design
 * (как slang/craft), запекается только выжимка одной карточки:
 * id, заголовок, класс/асценданси, main-skill, механика (коротко),
 * стадии (цена + короткая дельта), уники (имя + короткая note), PoB-ссылки.
 *
 * ПРАВИЛО ФАЙЛА: чистая сборка данных на стороне main-процесса при импорте;
 * сам рендер — в rendererHtml.ts (emitted-script, без импортов).
 */

import {
  listStarterBuildGuides,
  starterBuildClasses,
  starterBuildGuidesMeta,
  type StarterBuildGuide,
  type StarterBuildNameRef,
} from '@poe2-kit/core';

export interface OverlayStarterStage {
  k: 'starter' | 'mid' | 'main' | 'max';
  cost: string | null;
  delta?: string;
  note?: string;
}

export interface OverlayStarterGuide {
  id: string;
  /** Заголовок (title_ru). */
  t: string;
  cls: string;
  asc: string | null;
  /** Фейк/устаревание — выводить заметно (err-box). */
  warn?: string;
  variant?: string;
  /** Главный скилл: ru ?? en. */
  main: string;
  mainLvl?: number;
  /** Механика, обрезана до mechanics_ru ≤ MECH_MAX. */
  mech: string;
  stages: OverlayStarterStage[];
  /** Уники: имя (ru ?? en) + короткая note. */
  uniques: { name: string; note?: string }[];
  pobs: string[];
}

export interface OverlayStarterClasses {
  ru: string;
  en: string | null;
  total: number;
}

const MECH_MAX = 260;   // «коротко» — 2–3 предложения выжимки гайда
const DELTA_MAX = 170; // стадия: что покупать, одним абзацем
const NOTE_MAX = 70;    // ❓-note уника/стадии

function clip(s: string | null | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:]$/, '') + '…';
}

function nameOf(r: StarterBuildNameRef): string {
  return r?.ru ?? r?.en ?? '';
}

function compactBuild(b: StarterBuildGuide): OverlayStarterGuide {
  const stages: OverlayStarterStage[] = (['starter', 'mid', 'main', 'max'] as const)
    .filter((k) => b.stages?.[k])
    .map((k) => {
      const s = b.stages![k]!;
      const out: OverlayStarterStage = { k, cost: s.cost ?? null };
      const d = clip(s.delta, DELTA_MAX);
      if (d) out.delta = d;
      const n = clip(s.note, NOTE_MAX);
      if (n) out.note = n;
      return out;
    });
  return {
    id: b.id,
    t: b.title_ru,
    cls: b.class_ru,
    asc: b.ascendancy_ru ?? b.ascendancy_en ?? null,
    warn: clip(b.warning, DELTA_MAX),
    variant: clip(b.variant_note, DELTA_MAX),
    main: nameOf(b.main_skill) || '—',
    mainLvl: b.main_skill?.gem_level,
    mech: clip(b.mechanics_ru, MECH_MAX) ?? '',
    stages,
    uniques: (b.key_uniques ?? [])
      .map((u) => {
        const name = nameOf(u);
        if (!name) return null;
        const note = clip(u?.note, NOTE_MAX);
        return note ? { name, note } : { name };
      })
      .filter((u): u is { name: string; note?: string } => u !== null),
    pobs: (b.pob_links ?? []).filter((u) => /^https:\/\//.test(u)),
  };
}

/** Компактная выжимка всех билдов для запекания (один вызов на сборку HTML). */
export function compactStarterBuildGuides(): OverlayStarterGuide[] {
  return listStarterBuildGuides().map(compactBuild);
}

/** Классы со счётчиком — чипсы фильтра вкладки. */
export function compactStarterClasses(): OverlayStarterClasses[] {
  return starterBuildClasses().map((c) => ({ ru: c.class_ru, en: c.class_en, total: c.total }));
}

/** Мета-строка (патч/лига/срез) для подвала вкладки. */
export function compactStarterMeta(): { patch: string | null; league: string | null; asOf: string | null; total: number } {
  const m = starterBuildGuidesMeta();
  return { patch: m.patch, league: m.league, asOf: m.asOf, total: m.buildsTotal };
}
