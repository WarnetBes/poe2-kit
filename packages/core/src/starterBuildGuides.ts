/**
 * «🧬 Билды» (№257-паттерн, стартовые билды): курируемые билды PoE2
 * 0.5.x из ресёрч-волн №471-№477 (lootkeeper/maxroll/poe.ninja) -
 * data-словарь для web-вкладки и MCP-тулов.
 *
 * Наследует дисциплину radar.ts: файл - только факты из выжимок
 * ресёрча; неопубликованные цены - честно null; EN-канон ставился
 * только при сверке poe2db/maxroll, иначе null (UI должен это
 * показывать, а не выдумывать). Фейк-позиция продавца («Титан
 * Вихревой налёт») НЕ билд - предупреждение живёт в warning записи
 * titan-earthshatter.
 *
 * Загрузка - статический JSON-импорт `with {type:'json'}`
 * (конвенция №247/№248): файл идёт inline-в бандл core, доступен
 * и web-у, и MCP-клиенту без чтения с диска.
 *
 * Имя модуля - starterBuildGuides (не starterBuilds!): в
 * core/src/starterBuilds.ts живёт фича №92 - шопинг-листы прокачки,
 * overlay импортирует core.starterBuilds.
 */

import buildsFile from '../data/game/starter_builds.json' with { type: 'json' };

export interface StarterBuildStage {
  /** Опубликованная цена стадии (гайдом); null - не опубликована. */
  cost: string | null;
  /**
   * ₽-прайс витрины УСЛУГ lootkeeper (надбавка к базе, срез 12.10.2026,
   * журнал №484) - это цена услуги продавца, НЕ стоимость гира.
   * Опционально: только у билдов, где ₽-прайс снят с product-страницы.
   */
  lootkeeper_rub?: string;
  /** Что меняется на стадии (гиры/уники/механика). */
  delta?: string;
  /** Уточнение, если данных мало. */
  note?: string;
}

export interface StarterBuildSkillRef {
  ru?: string | null;
  en?: string | null;
  gem_level?: number;
  note?: string;
}

export interface StarterBuildNameRef {
  ru?: string | null;
  en?: string | null;
  note?: string;
}

export interface StarterBuildGuide {
  id: string;
  title_ru: string;
  title_en?: string | null;
  class_ru: string;
  class_en?: string | null;
  ascendancy_ru?: string | null;
  ascendancy_en?: string | null;
  /** Предупреждение (фейк-связки, устаревший гайд и т.п.) - выводить заметно. */
  warning?: string;
  seller_note?: string;
  seller_prices_ru?: string;
  variant_note?: string;
  author?: string;
  note_ru?: string;
  main_skill: StarterBuildSkillRef;
  supports: StarterBuildNameRef[];
  ascendancy_order: StarterBuildNameRef[];
  key_uniques: StarterBuildNameRef[];
  gear_tips: Record<string, string>;
  mechanics_ru: string;
  pros: string[];
  cons: string[];
  stages: Partial<Record<'starter' | 'mid' | 'main' | 'max', StarterBuildStage>>;
  pob_links: string[];
  sources: string[];
}

interface BuildsFile {
  _meta?: { version?: number; league?: string; patch?: string; as_of?: string; sources?: string[]; note?: string };
  builds?: StarterBuildGuide[];
}

function isNameRef(raw: unknown): raw is StarterBuildNameRef {
  return raw == null || typeof raw === 'object';
}

function isStage(raw: unknown): raw is StarterBuildStage {
  if (raw == null || typeof raw !== 'object') return false;
  const o = raw as Partial<StarterBuildStage>;
  return o.cost === undefined || o.cost === null || typeof o.cost === 'string';
}

/** Валидатор записи билда: id/title/class/mechanics/main_skill обязательны. */
function isBuild(raw: unknown): raw is StarterBuildGuide {
  if (raw == null || typeof raw !== 'object') return false;
  const o = raw as Partial<StarterBuildGuide>;
  if (
    !(typeof o.id === 'string' && o.id.trim().length > 0) ||
    !(typeof o.title_ru === 'string' && o.title_ru.length > 0) ||
    !(typeof o.class_ru === 'string' && o.class_ru.length > 0) ||
    !(typeof o.mechanics_ru === 'string' && o.mechanics_ru.length > 0) ||
    o.main_skill == null ||
    typeof o.main_skill !== 'object'
  ) return false;
  const ms = o.main_skill as Partial<StarterBuildSkillRef>;
  if (!(typeof ms.ru === 'string' || typeof ms.en === 'string')) return false;
  if (o.stages != null) {
    if (typeof o.stages !== 'object' || Array.isArray(o.stages)) return false;
    for (const st of Object.values(o.stages)) {
      if (st !== undefined && !isStage(st)) return false;
    }
  }
  for (const key of ['supports', 'ascendancy_order', 'key_uniques', 'pros', 'cons', 'pob_links', 'sources'] as const) {
    const v = o[key];
    if (v !== undefined && !Array.isArray(v)) return false;
    if (v !== undefined && (key === 'supports' || key === 'ascendancy_order' || key === 'key_uniques')) {
      for (const item of v) if (!isNameRef(item)) return false;
    }
  }
  return true;
}

/** Парсинг payload'а (тест/inline): мусор пропускаем молча. */
export function parseStarterBuildGuides(raw: unknown): StarterBuildGuide[] {
  if (!raw || typeof raw !== 'object') return [];
  const f = raw as BuildsFile;
  if (!Array.isArray(f.builds)) return [];
  return f.builds.filter(isBuild);
}

/** Полный список билдов (порядок файла = порядок курации). */
export function listStarterBuildGuides(): StarterBuildGuide[] {
  return parseStarterBuildGuides(buildsFile);
}

/** Поиск по id (deep-links/MCP-запросы «расскажи про X»). */
export function findStarterBuildGuide(id: string): StarterBuildGuide | null {
  const k = id.trim();
  return listStarterBuildGuides().find((b) => b.id === k) ?? null;
}

/** Фильтр по классу: RU или EN имя (регистронезависимо). */
export function starterBuildGuidesByClass(cls: string): StarterBuildGuide[] {
  const k = cls.trim().toLowerCase();
  if (!k) return [];
  return listStarterBuildGuides().filter(
    (b) => b.class_ru?.toLowerCase() === k || b.class_en?.toLowerCase() === k,
  );
}

/** Фильтр по асценденси: RU или EN имя (регистронезависимо). */
export function starterBuildGuidesByAscendancy(asc: string): StarterBuildGuide[] {
  const k = asc.trim().toLowerCase();
  if (!k) return [];
  return listStarterBuildGuides().filter(
    (b) => b.ascendancy_ru?.toLowerCase() === k || b.ascendancy_en?.toLowerCase() === k,
  );
}

/** Подстрока-поиск по id/заголовкам/классу/асценденси/главному скиллу. */
export function searchStarterBuildGuides(query: string): StarterBuildGuide[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return listStarterBuildGuides().filter((b) => {
    const hay = [
      b.id,
      b.title_ru,
      b.title_en ?? '',
      b.class_ru,
      b.class_en ?? '',
      b.ascendancy_ru ?? '',
      b.ascendancy_en ?? '',
      b.main_skill.ru ?? '',
      b.main_skill.en ?? '',
    ];
    return hay.some((s) => typeof s === 'string' && s.toLowerCase().includes(q));
  });
}

/** Уникальные классы со счётчиком (группировка web-вкладки). */
export function starterBuildClasses(): { class_ru: string; class_en: string | null; total: number }[] {
  const out = new Map<string, { class_ru: string; class_en: string | null; total: number }>();
  for (const b of listStarterBuildGuides()) {
    const cur = out.get(b.class_ru);
    if (cur) cur.total += 1;
    else out.set(b.class_ru, { class_ru: b.class_ru, class_en: b.class_en ?? null, total: 1 });
  }
  return [...out.values()];
}

/** Мета data-файла (self-describe для UI/тулов). */
export function starterBuildGuidesMeta(): {
  patch: string | null;
  league: string | null;
  asOf: string | null;
  note: string | null;
  buildsTotal: number;
  withPrices: number;
  classesTotal: number;
  pobLinksTotal: number;
} {
  const all = listStarterBuildGuides();
  const meta = buildsFile._meta;
  return {
    patch: meta?.patch ?? null,
    league: meta?.league ?? null,
    asOf: meta?.as_of ?? null,
    note: meta?.note ?? null,
    buildsTotal: all.length,
    withPrices: all.filter((b) =>
      Object.values(b.stages ?? {}).some((s) => s && s.cost != null),
    ).length,
    classesTotal: starterBuildClasses().length,
    pobLinksTotal: all.reduce((a, b) => a + (b.pob_links?.length ?? 0), 0),
  };
}

export type { BuildsFile };
