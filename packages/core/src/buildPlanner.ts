/**
 * Экспорт билда в официальный формат *.build (Build Planner PoE2, 0.5.x).
 *
 * Формат (спецификация GGG, pathofexile.com/developer/docs/game —
 * «Build Planner (PoE2 only)», schema v1 / experimental):
 *  - файл — plain JSON, один корневой объект Build;
 *  - кладётся в `Documents/My Games/Path of Exile 2/BuildPlanner/*.build`,
 *    игру перезапускают, File Watcher подхватывает файл молча (битый JSON =
 *    тихий отказ загрузки).
 *  - ключи: name, author?, link?, description?, ascendancy? («Monk1»-код),
 *    passives? (slug-ы узлов или {id, additional_text}), skills?
 *    ({id: Metadata/Items/Gems/…, support_skills}), inventory_slots?
 *    ({inventory_id, additional_text | unique_name, level_interval?}).
 *
 * Конвертация — это задача маппинга идентификаторов (PoB хранит числовые
 * id узлов и имена камней, формат GGG требует slug-и и metadata-пути).
 * Карты — data/game/build_planner/map.json, экстрактор
 * scripts/extract-build-planner-map.mjs (источники: PoB2 TreeData 0_5
 * stringId + Gems.lua gameId). Непокрытое — честные warnings, БЕЗ выдуманных
 * полей: игра молча грузит файл, но выдуманный slug/путь просто не покажется.
 *
 * НЕ реализовано (осознанно, см. TODO внизу файла): level_interval-гейтинг
 * гема по уровню, weapon_set-специфика узлов, jewels, multi-stage прогрессия.
 */

import type { BuildGearItem, BuildImport } from './types.js';
import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';
import { getSkillGemDetails } from './dataset.js';

// ─── Формат *.build (типы по спецификации GGG) ──────────────────────────────

/** Узел дерева: slug GGG (PassiveSkills.id) + опциональная аннотация. */
export interface BuildPlannerPassive {
  id: string;
  additional_text?: string;
}

/** Скилл: metadata-путь камня + саппорты той же группы. */
export interface BuildPlannerSkill {
  id: string;
  additional_text?: string;
  /** Гейт leveling-плана: [уровень появления, 100] (E7). */
  level_interval?: [number, number];
  support_skills: Array<string | BuildPlannerSkill>;
}

/** Слот снаряжения: guidance-текст (рары) или имя уникаля. */
export interface BuildPlannerInventorySlot {
  inventory_id: string;
  additional_text?: string;
  unique_name?: string;
  level_interval?: [number, number];
}

/** Корневой объект Build — ровно то, что пишет в *.build. */
export interface BuildPlannerBuild {
  name: string;
  author?: string;
  link?: string;
  description?: string;
  ascendancy?: string;
  passives?: Array<string | BuildPlannerPassive>;
  skills?: Array<string | BuildPlannerSkill>;
  inventory_slots?: BuildPlannerInventorySlot[];
}

/** Опции конвертации. */
export interface ToBuildPlannerOptions {
  /** Имя билда (по умолчанию «{Класс} — {Асценданси}»). Игра режет display ~40 симв. */
  name?: string;
  /** Автор (optional по формату; GGG-примеры пишут «Grinding Gear Games»). */
  author?: string;
  /** Ссылка-источник (po b.in/pastebin/…), попадает в link. */
  link?: string;
  /** Описание/титульная заметка (description). */
  description?: string;
  /**
   * Снаряжение с клир-текстом предметов (buildCodeToGear) — для честного
   * inventory_slots: unique_name из Rarity-строки или additional_text из
   * модов. Без gearItems слоты НЕ экспортируются (в BuildImport.gear только
   * имена, а выдумывать мод-листы запрещено).
   */
  gearItems?: BuildGearItem[];
}

/** Результат конвертации. */
export interface BuildPlannerResult {
  /** Готовое содержимое *.build (JSON, UTF-8). */
  json: string;
  /** Собранный объект Build (для программной доработки перед записью). */
  build: BuildPlannerBuild;
  /** Проблемы конвертации: что НЕ попало в файл и почему. */
  warnings: string[];
  /** Рекомендуемое имя файла («X.build») — санированное имя билда. */
  filename: string;
}

// ─── Карты идентификаторов (data/game/build_planner/map.json) ───────────────

interface ConverterMap {
  metadata: Record<string, unknown>;
  numeric_to_slug: Record<string, string>;
  gem_name_to_metadata: Record<string, string>;
}

let mapCache: ConverterMap | null = null;

function loadMap(): ConverterMap {
  if (mapCache) return mapCache;
  if (!HAS_DISK) {
    throw new Error('Карты конвертера *.build недоступны в браузере: нужен офлайн-датасет.');
  }
  const dir = pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
    'build_planner',
  );
  mapCache = JSON.parse(fsMod!.readFileSync(pathMod!.join(dir, 'map.json'), 'utf8')) as ConverterMap;
  return mapCache;
}

/** Сбросить кэш карт (для тестов после подмены датасета). */
export function clearBuildPlannerCache(): void {
  mapCache = null;
  gameIdsCache = null;
  gameIdsSetCache = null;
  gameIdValsCache = null;
  uniquesCache = null;
  gemMetaToNameCache = null;
}

// ─── Канон gameId гемов (data/game/build_planner/gem_gameids.json, №717) ─────
//
// №717/№722 (живая сверка): игра валидирует skills[].id по gameId из
// Gems.lua PoB2 (поле gameId), НЕ по ключу датасета. 785/966 gameId ≠ ключа
// (0.5.x-переименования: AscendancySkillGems, Gem/ vs Gems/ и т.д.).
// Файл опционален (браузер/нет файла → null → конвертер и валидатор честно
// деградируют до старого поведения; имена/searches не выдумываем).

interface GameIdsFile {
  _meta?: Record<string, unknown>;
  map: Record<string, string>;
}

let gameIdsCache: Record<string, string> | null = null;
let gameIdsSetCache: Set<string> | null = null;
let gameIdValsCache: Set<string> | null = null;

/** datasetKey → gameId; null, если датасет недоступен (браузер/нет файла). */
function loadGameIds(): Record<string, string> | null {
  if (gameIdsCache) return gameIdsCache;
  if (!HAS_DISK) return null;
  try {
    const dir = pathMod!.join(
      pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
      '..',
      'data',
      'game',
      'build_planner',
    );
    const raw = JSON.parse(fsMod!.readFileSync(pathMod!.join(dir, 'gem_gameids.json'), 'utf8')) as GameIdsFile;
    gameIdsCache = raw.map ?? null;
    return gameIdsCache;
  } catch {
    return null; // опциональный канон: отсутствие — НЕ ошибка
  }
}

/** Множество ВАЛИДНЫХ gameId (union значений словаря + ключей-тождеств). */
function knownGameIds(): Set<string> {
  if (gameIdsSetCache) return gameIdsSetCache;
  const map = loadGameIds();
  const set = new Set<string>();
  if (map) {
    for (const [k, v] of Object.entries(map)) {
      set.add(v);
      if (k === v) set.add(k);
    }
  }
  gameIdsSetCache = set;
  return set;
}

/** Множество ЗНАЧЕНИЙ словаря (только gameId, без datasetKey-тождеств). */
function gameIdValues(): Set<string> {
  if (gameIdValsCache) return gameIdValsCache;
  const map = loadGameIds();
  gameIdValsCache = map ? new Set(Object.values(map)) : new Set<string>();
  return gameIdValsCache;
}

// ─── Каталог уников (uniques/uniques_catalog.json, №721) ──────────────────────
//
// №721 (живой факт): игра отвергает ВЕСЬ файл, если unique_name ей не знаком.
// Гейт смотрит локальный каталог (lowercase-ключи); промах = error-тон, но
// с честной оговоркой: каталог ≠ полный список игры (кейс Aul's Dominance —
// предмет реален, в PoB2-каталоге отсутствовал), новые уники патча тоже дадут
// промах — текст обязан это говорить, а не «такого уника нет».

let uniquesCache: Set<string> | null = null;

/** Множество lowercase-имён уников из каталога; null — каталог недоступен. */
function knownUniqueNames(): Set<string> | null {
  if (uniquesCache) return uniquesCache;
  if (!HAS_DISK) return null;
  try {
    const dir = pathMod!.join(
      pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
      '..',
      'data',
      'game',
      'uniques',
    );
    const raw = JSON.parse(fsMod!.readFileSync(pathMod!.join(dir, 'uniques_catalog.json'), 'utf8')) as {
      uniques?: Record<string, unknown>;
    };
    if (!raw.uniques || typeof raw.uniques !== 'object') return null;
    uniquesCache = new Set(Object.keys(raw.uniques));
    return uniquesCache;
  } catch {
    return null; // опциональный каталог: отсутствие — гейт просто не срабатывает
  }
}

// ─── Асценданси: display-name → код «{Class}{N}» ─────────────────────────────

interface AscendancyRow {
  id: string;
  display_name?: string;
  base_class?: string;
  is_unused?: boolean;
}

let ascCache: Map<string, string> | null = null;
/** Нижний регистр display_name → id («monk2» → «Monk2»). */
function ascendancyCodes(): Map<string, string> {
  if (ascCache) return ascCache;
  const dir = pathMod!.join(
    pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)),
    '..',
    'data',
    'game',
  );
  const raw = JSON.parse(
    fsMod!.readFileSync(pathMod!.join(dir, 'ascendancies', 'ascendancies.json'), 'utf8'),
  ) as { ascendancies?: AscendancyRow[] };
  const m = new Map<string, string>();
  for (const a of raw.ascendancies ?? []) {
    if (a.is_unused || !a.display_name || !a.id) continue;
    m.set(a.display_name.toLowerCase(), a.id);
  }
  ascCache = m;
  return m;
}

/**
 * Разрешить асценданси: «Invoker» → «Monk2». Если на входе уже код
 * («Monk2», «Warrior1») — проверить по датасету и пропустить как есть.
 */
function resolveAscendancy(asc: string | undefined, warnings: string[]): string | undefined {
  if (!asc) return undefined;
  const codes = ascendancyCodes();
  const direct = codes.get(asc.toLowerCase());
  if (direct) return direct;
  if (/^[A-Za-z]+\d+[a-z]?$/.test(asc)) {
    const known = [...codes.values()].some((c) => c.toLowerCase() === asc.toLowerCase());
    if (!known) warnings.push(`асценданси-код «${asc}» не найден в датасете — оставлен как есть`);
    return asc;
  }
  warnings.push(`асценданси «${asc}» не распознан (кода нет в ascendancies.json) — поле ascendancy пропущено`);
  return undefined;
}

// ─── Пассивки: числовой PoB-id | slug → slug ───────────────────────────────

/** Похоже ли на GGG-slug («melee17», «AscendancyMonk2Notable9»)? Не цифры. */
function isSlugLike(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(s) && !/^\d+$/.test(s);
}

function convertPassives(nodes: string[], warnings: string[]): Array<string | BuildPlannerPassive> {
  const map = loadMap().numeric_to_slug;
  const out: Array<string | BuildPlannerPassive> = [];
  const seen = new Set<string>();
  const unmapped: string[] = [];
  for (const raw of nodes) {
    const n = raw.trim();
    if (!n) continue;
    // Slug мог уже прийти из .build-импорта — не трогаем.
    const slug = isSlugLike(n) ? n : map[n];
    if (slug) {
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(slug);
      }
      continue;
    }
    unmapped.push(n);
  }
  if (unmapped.length > 0) {
    warnings.push(
      `узлов дерева без маппинга: ${unmapped.length} (${unmapped.slice(0, 5).join(', ')}…) — ` +
        'не попали в passives; вероятно, дерево экспорта старше TreeData 0_5',
    );
  }
  return out;
}

// ─── Скиллы: имя камня → Metadata/Items/Gems/… ──────────────────────────────

/**
 * Level_interval активного гема (E7): [min, 100] — с какого уровня персонажа
 * гем появляется в leveling-плане игры. Min — требование уровня строки гема
 * из датасета (skill_gems_v2 levels[].levelRequirement): если PoB несёт
 * уровень гема — требование именно этой ступени (донорский канон Tincture
 * build-from-ninja.cjs: «gate by each gem's REAL Level requirement»);
 * без уровня — уровень открытия (первое требование > 0), иначе 1.
 * Гем не найден в датасете — поле ЧЕСТНО опускается (не выдумываем).
 * Саппорты: датасет требований не несёт — им level_interval не пишем.
 */
function gemLevelInterval(name: string, gemLevel: number | null): [number, number] | undefined {
  const det = getSkillGemDetails(name);
  if (!det || !det.levels || det.levels.length === 0) return undefined;
  const idx = gemLevel && gemLevel >= 1 ? Math.min(gemLevel, det.levels.length) - 1 : -1;
  const req =
    idx >= 0
      ? det.levels[idx].levelRequirement
      : det.levels.find((l) => l.levelRequirement > 0)?.levelRequirement ?? 0;
  return [req > 0 ? req : 1, 100];
}

function gemMetadataId(name: string): string | undefined {
  const exact = loadMap().gem_name_to_metadata[name];
  if (exact) return exact;
  // PoB иногда пишет nameSpec с вариативным суффиксом римской ступени
  // («Rapid Attacks», «Fire Attunement») — пробуем I-ю ступень как fallback.
  const tiered = loadMap().gem_name_to_metadata[`${name} I`];
  if (tiered) return tiered;
  return undefined;
}

/**
 * DatasetKey Gems.lua → канонический gameId для skills[].id (№717).
 * Словарь gem_gameids.json опционален: нет файла → старый behavior (ключ
 * как есть), предупредление не нужно — gameId-фейл мягкий (красные «?»).
 *
 * Коллизия пространств (найдена при сверке, кейс Siege Ballista):
 * gameId одного гема может быть datasetKey другого (gameId
 * SkillGemSiegeBallista = «SkillGemArtilleryBallista» = datasetKey гема с
 * gameId «SkillGemRipwireBallista»). Поэтому правило rewrite НЕ «значение
 * есть ключ → заменить», а «замена только если она безопасна»: значение
 * само является чьим-то gameId И его словарная замена НЕ является gameId
 * никакого гема → тогда это datasetKey-пробел, rewrite легитимен. Значение,
 * которое уже gameId (есть среди значений словаря) и при этом ключ —
 * оставляем как есть (оно уже канонично).
 */
function canonicalGemId(datasetKey: string): string {
  const dict = loadGameIds();
  if (!dict) return datasetKey;
  const rewritten = dict[datasetKey];
  if (rewritten === undefined || rewritten === datasetKey) return datasetKey;
  // datasetKey сам — чей-то gameId? Тогда запись уже канонична, rewrite
  // грозит переписать легитимный gameId в gameId другого гема.
  if (gameIdValues().has(datasetKey)) return datasetKey;
  return rewritten;
}

function isSupportName(name: string): boolean {
  const id = gemMetadataId(name);
  return id ? /SupportGem/.test(id) : /\sSupport$/i.test(name);
}

let gemMetaToNameCache: Map<string, string> | null = null;

/**
 * Обратная карта gem_name_to_metadata: Metadata-путь гема → display-имя.
 * Экспортировано для парсера .build (E6): там скиллы/саппорты заданы
 * Metadata-путями, а consumers (pobCompare, gemSupports) работают по именам.
 * Фолбэк при промахе — хвост пути,Caller решает сам.
 * №717: путь может быть gameId (Gem/ vs Gems/, переименованный 0.5.x) —
 * обратная карта расширена и на gameId-пространство gem_gameids.json.
 */
export function gemMetadataIdToName(id: string): string {
  if (!gemMetaToNameCache) {
    const inv = new Map<string, string>();
    for (const [name, meta] of Object.entries(loadMap().gem_name_to_metadata)) {
      // при дублях путей (несколько имён → один гем) держим первое имя
      if (!inv.has(meta)) inv.set(meta, name);
    }
    // gameId → datasetKey → имя (канон №717; не перезаписываем прямые хиты)
    const dict = loadGameIds();
    if (dict) {
      for (const [datasetKey, gameId] of Object.entries(dict)) {
        if (!inv.has(gameId)) {
          const name = inv.get(datasetKey);
          if (name) inv.set(gameId, name);
        }
      }
    }
    gemMetaToNameCache = inv;
  }
  return gemMetaToNameCache.get(id) ?? gemMetadataToSibling(id);
}

/** Хвост Metadata-пути («…/SupportGemMartialTempoTwo» → «MartialTempoTwo»). */
function gemMetadataToSibling(id: string): string {
  const tail = id.split('/').pop() ?? id;
  return tail.replace(/^(Skill|Support)Gem/, '');
}

/** Саппорт ли гем по имени: по Metadata-пути (SupportGem*), фолбэк — суффикс " Support" (PoE1-стиль).
 *  Экспортировано для pobCompare (E2): PoE2-саппорты НЕ несут суффикс в имени. */
export function isSupportGemName(name: string): boolean {
  return isSupportName(name);
}

function convertSkills(build: BuildImport, warnings: string[]): BuildPlannerSkill[] {
  const map = loadMap().gem_name_to_metadata;
  const out: BuildPlannerSkill[] = [];
  const seenSkill = new Set<string>();
  const unmapped = new Set<string>();

  const groups = (build.skillGroups ?? []).filter((g) => g.enabled);
  if (groups.length > 0) {
    for (const g of groups) {
      const actives = g.gems.filter((x) => !isSupportName(x.name));
      const supports = g.gems.filter((x) => isSupportName(x.name));
      for (const active of actives) {
        const id = gemMetadataId(active.name);
        if (!id) {
          unmapped.add(active.name);
          continue;
        }
        if (seenSkill.has(id)) continue; // тот же активный в двух группах — один раз
        seenSkill.add(id);
        const sup: BuildPlannerSkill['support_skills'] = [];
        const seenSup = new Set<string>();
        for (const s of supports) {
          const sid = gemMetadataId(s.name);
          if (!sid) {
            unmapped.add(s.name);
            continue;
          }
          if (!seenSup.has(sid)) {
            seenSup.add(sid);
            sup.push(canonicalGemId(sid)); // №717: саппорты — тоже gameId-канон
          }
        }
        const interval = gemLevelInterval(active.name, active.level);
        const cid = canonicalGemId(id); // №717: игра ждёт поле gameId из Gems.lua
        out.push({ id: cid, support_skills: sup, ...(interval ? { level_interval: interval as [number, number] } : {}) });
      }
    }
  } else if (build.skills.length > 0) {
    // Групп нет (легаси-парсер) — плоский список имён без саппортов;
    // уровень гема не известен — гейт по уровню открытия гема из датасета.
    for (const name of build.skills) {
      const id = gemMetadataId(name);
      if (!id) {
        unmapped.add(name);
        continue;
      }
      if (!seenSkill.has(id)) {
        seenSkill.add(id);
        const interval = gemLevelInterval(name, null);
        const cid = canonicalGemId(id); // №717
        out.push({ id: cid, support_skills: [], ...(interval ? { level_interval: interval as [number, number] } : {}) });
      }
    }
    if (build.skills.length > 0 && out.length > 0) {
      warnings.push('группы камней не найдены (старый экспорт PoB1) — саппорты не восстановлены');
    }
  }

  if (unmapped.size > 0) {
    warnings.push(
      `камней без маппинга: ${unmapped.size} (${[...unmapped].slice(0, 5).join(', ')}…) — ` +
        `имя отсутствует в Gems.lua (карта покрывает ${Object.keys(map).length} имён)`,
    );
  }
  return out;
}

// ─── Снаряжение: PoB-слот → inventory_id, клир-текст → guidance ──────────────

/**
 * PoB-слот (ItemSet/Slot name) → inventory_id из словаря формата.
 * №722 (живая сверка с игрой): экспортируем ТОЛЬКО принимаемые игрой слоты:
 * Weapon1/2, Helm1, BodyArmour1, Gloves1, Boots1, Amulet1, Ring1/2, Belt1,
 * Flask1. Мёртвые Charm1-3 и Flask2-5 игра отвергает молча (реально — ВЕСЬ
 * файл), поэтому они здесь отсутствуют: convertInventory их честно
 * пропускает с warning вместо эмитта гарантированно битого файла.
 */
const SLOT_TO_INVENTORY: Record<string, string> = {
  'Weapon 1': 'Weapon1',
  'Weapon 2': 'Weapon2',
  Helm: 'Helm1',
  Helmet: 'Helm1', // PoB пишет «Helmet» в ItemSet/Slot
  'Body Armour': 'BodyArmour1',
  Gloves: 'Gloves1',
  Boots: 'Boots1',
  Belt: 'Belt1',
  Amulet: 'Amulet1',
  'Ring 1': 'Ring1',
  'Ring 2': 'Ring2',
  'Flask 1': 'Flask1',
};

/** inventory_id, которые НЕ принимает игра (молча убивают весь файл, №719/№722). */
const DEAD_INVENTORY_IDS = ['Charm1', 'Charm2', 'Charm3', 'Flask2', 'Flask3', 'Flask4', 'Flask5'];

/** Строки клир-текста, которые НЕ являются модами (метаданные предмета). */
const NON_MOD_LINE = /^(rarity:|--------|item level:|requirements|.+\s\d+$)/i;

function convertInventory(items: BuildGearItem[], warnings: string[]): BuildPlannerInventorySlot[] {
  const out: BuildPlannerInventorySlot[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const inventoryId = SLOT_TO_INVENTORY[it.slot];
    if (!inventoryId) {
      // №722: PoB-слоты Charm 1-3 / Flask 2-5 соответствуют мёртвым
      // inventory_id (Charm1-3, Flask2-5) — игра отвергает ВЕСЬ файл;
      // пропускаем предмет предупреждением, а не эмиттим битый файл.
      const dead = /Charm\s*[123]|Flask\s*[2-5]/.test(it.slot);
      warnings.push(
        dead
          ? `слот «${it.slot}» (inventory_id ${it.slot.replace(/\s/g, '')}) НЕ принимается игрой — предмет «${it.name}» пропущен (иначе игра молча отвергнет весь .build)`
          : `слот «${it.slot}» не входит в словарь inventory_id — предмет «${it.name}» пропущен`,
      );
      continue;
    }
    if (seen.has(inventoryId)) continue;
    seen.add(inventoryId);

    const lines = it.itemText.split('\n').map((l) => l.trim()).filter(Boolean);
    const rarityIdx = lines.findIndex((l) => /^rarity:/i.test(l));
    const rarity = rarityIdx >= 0 ? lines[rarityIdx]!.toLowerCase().replace('rarity:', '').trim() : '';
    const nameLine = rarityIdx >= 0 && lines[rarityIdx + 1] ? lines[rarityIdx + 1]! : it.name;

    if (rarity === 'unique') {
      // Уникаль: формат требует ТОЛЬКО имя (unique_name), без текста модов.
      // Источник — имя из клир-текста (строка после Rarity); it.name может
      // быть базовым типом при ручной сборке gearItems.
      out.push({ inventory_id: inventoryId, unique_name: nameLine || it.name });
      continue;
    }

    // Рар/белый/синий: guidance-текст — первая строка имя/база, дальше
    // нумерованные моды («1. …», «2. …») — конвенция реальных экспортов GGG.
    const divider = lines.indexOf('--------');
    const modLines = lines
      .slice(divider >= 0 ? divider + 1 : rarityIdx + 2)
      .filter((l) => l && !NON_MOD_LINE.test(l));
    const first = it.name || (rarityIdx >= 0 ? nameLine : (lines[0] ?? it.slot));
    // additional_text — PoE2 Custom Text markup: { } — делимитеры разметки
    // (<bold>{ … } и т.п.), посторонние скобы в тексте мода ломают парсер игры.
    // Донор: PoB2 BuildExportPoE2.lua:185-188 (stripBraces).
    const stripBraces = (s: string): string => s.replace(/[{}]/g, '');
    const additional = [stripBraces(first), ...modLines.map((l, i) => `${i + 1}. ${stripBraces(l)}`)].join('\n');
    out.push({ inventory_id: inventoryId, additional_text: additional });
  }
  return out;
}

// ─── Публичный API ──────────────────────────────────────────────────────────

/** Санировать имя билда в имя файла («Invoker Ice Strike» → «Invoker Ice Strike.build»). */
export function buildPlannerFilename(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  return `${safe || 'build'}.build`;
}

/**
 * Конвертировать билд (BuildImport из importBuild/PoB-кода) в объект *.build.
 * Возвращает строку-JSON, объект и список предупреждений. Ничего не пишет на
 * диск и в сеть: запись в BuildPlanner — задача вызывающего (TODO: тул/MCP).
 */
export function toBuildPlanner(build: BuildImport, opts: ToBuildPlannerOptions = {}): BuildPlannerResult {
  const warnings: string[] = [];

  const ascendancy = resolveAscendancy(build.ascendancy, warnings);
  const passives = convertPassives(build.passiveNodes ?? [], warnings);
  const skills = convertSkills(build, warnings);

  // SCHEMA v1: шесть ключей ОБЯЗАТЕЛЬНЫ (author/ascendancy/name/
  // inventory_slots/passives/skills — Tincture SCHEMA.md:13-23, buildfile.py
  // эмиттит все шесть всегда). Пустые массивы валидны; пропущенный ключ —
  // риск молчаливого отказа игры, поэтому пустые пишем явно.
  // Исключение — ascendancy: если код не разрешён, поле ЧЕСТНО опускается
  // (не выдумываем) — поймает validateBuildPlanner перед записью.
  const out: BuildPlannerBuild = {
    name: opts.name ?? [build.class, build.ascendancy].filter(Boolean).join(' — ') ?? 'Imported build',
    author: opts.author ?? 'poe2-kit',
    passives,
    skills,
    inventory_slots: [],
  };
  if (!out.name) out.name = 'Imported build';
  if (opts.link) out.link = opts.link;
  if (opts.description) out.description = opts.description;
  if (ascendancy) out.ascendancy = ascendancy;

  if (opts.gearItems && opts.gearItems.length > 0) {
    const inv = convertInventory(opts.gearItems, warnings);
    if (inv.length > 0) out.inventory_slots = inv;
  } else if (Object.keys(build.gear ?? {}).length > 0) {
    warnings.push(
      'снаряжение передано только именами (BuildImport.gear) — inventory_slots не экспортированы; ' +
        'передайте gearItems = buildCodeToGear(код) для клир-текста предметов',
    );
  }

  return {
    json: JSON.stringify(out, null, 2),
    build: out,
    warnings,
    filename: buildPlannerFilename(out.name),
  };
}

// ─── Валидация *.build (гейт до записи: игра на малформ отвечает молча) ─────

/** Результат валидации: valid = нет structural-ошибок; warnings информативны. */
export interface BuildPlannerValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Shape асценданси-кода: «{Class}{N}» + буквенный вариант «Witch3b». */
const ASC_CODE_SHAPE = /^[A-Z][a-z]+\d+[a-z]?$/;

/** Словарь inventory_id из SLOT_TO_INVENTORY (то, что эмиттим сами). */
const KNOWN_INVENTORY_IDS = new Set<string>(Object.values(SLOT_TO_INVENTORY));

/** Пассивка: строка-slug или {id: slug}. */
function passiveId(p: unknown): string | undefined {
  if (typeof p === 'string') return p.trim() ? p : undefined;
  if (typeof p === 'object' && p !== null) {
    const id = (p as Record<string, unknown>).id;
    return typeof id === 'string' && id.trim() ? id : undefined;
  }
  return undefined;
}

/** level_interval: пара чисел [min, max]. */
function isLevelInterval(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number'
  );
}

/**
 * Проверить объект *.build (или его JSON-строку) против схемы v1.
 * Ошибки (errors) — то, на чём игра молча откажется грузить файл:
 * битый JSON, не-объект, отсутствие обязательных ключей, неверные типы/shape
 * слотов/пассивок/скиллов — и ГЕЙТЫ живой сверки (№717-№722):
 *  - inventory_id вне белого списка → error (№719/№722: ВЕСЬ файл отвергается);
 *  - unique_name вне каталога уников → error (№721), текст честно
 *    оговаривает неполноту каталога (кейс Aul's Dominance / новые уники
 *    патча / RU-имена клир-текста — играть можно только EN-имя);
 *  - skills[].id вне gameId-канона → warning (№717: НЕ ломает файл — у гема
 *    красные «?»); известный datasetKey вместо gameId — warning с рекомендацией.
 *
 * Список обязательных ключей — из Tincture SCHEMA.md:13-23 (6 ключей,
 * reverse-engineered с реальных экспортов 0.5.0).
 */
export function validateBuildPlanner(input: unknown): BuildPlannerValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  let root: unknown = input;
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { valid: false, errors: [`битый JSON (${msg}) — игра молча откажется грузить файл`], warnings };
    }
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    errors.push('корень файла — не объект Build (массив/не-объект)');
    return { valid: false, errors, warnings };
  }
  const b = root as Record<string, unknown>;

  // Шесть обязательных ключей (SCHEMA.md:13-23).
  for (const key of ['author', 'ascendancy', 'name', 'inventory_slots', 'passives', 'skills']) {
    if (!(key in b)) errors.push(`нет обязательного ключа «${key}»`);
  }

  // Имя: непустая строка; длинное — режется только display, не запись.
  if (typeof b.name !== 'string' || !b.name.trim()) {
    errors.push('name — непустая строка');
  } else if (b.name.length > 40) {
    warnings.push(`name длиннее 40 симв. (${b.name.length}) — игра обрежет только display`);
  }

  if ('author' in b && typeof b.author !== 'string') errors.push('author — строка');
  if ('description' in b && typeof b.description !== 'string') errors.push('description — строка');
  if ('link' in b && typeof b.link !== 'string') errors.push('link — строка');

  // Асценданси: код «{Class}{N}»/«Witch3b». Неизвестный код — warning:
  // датасет может отставать от игры; сломанный shape — error.
  if ('ascendancy' in b) {
    const asc = b.ascendancy;
    if (typeof asc !== 'string' || !ASC_CODE_SHAPE.test(asc)) {
      errors.push(`ascendancy «${String(asc)}» не соответствует shape «{Class}{N}[b]»`);
    } else if (!ascendancyCodeExists(asc)) {
      warnings.push(`асценданси-код «${asc}» не найден в ascendancies.json — уточнить актуальность датасета`);
    }
  }

  // inventory_slots: слот = inventory_id + (unique_name | additional_text).
  if ('inventory_slots' in b) {
    const slots = b.inventory_slots;
    if (!Array.isArray(slots)) {
      errors.push('inventory_slots — массив');
    } else {
      if (slots.length === 0) warnings.push('inventory_slots пуст — билд без снаряжения (валидно)');
      slots.forEach((s, i) => {
        const label = `inventory_slots[${i}]`;
        if (typeof s !== 'object' || s === null) {
          errors.push(`${label} — объект`);
          return;
        }
        const slot = s as Record<string, unknown>;
        const inv = slot.inventory_id;
        const unique = slot.unique_name;
        const text = slot.additional_text;
        if (typeof inv !== 'string' || !inv.trim()) {
          errors.push(`${label}.inventory_id — непустая строка`);
        } else if (!KNOWN_INVENTORY_IDS.has(inv)) {
          // Гейт №719/№722 (живая сверка): неподдерживаемый inventory_id
          // игра отвергает МОЛЧА — весь файл не грузится. Мёртвые Charm1-3 /
          // Flask2-5 — известный подкласс с отдельным текстом.
          errors.push(
            `${label}.inventory_id «${inv}» НЕ поддерживается игрой — ` +
              (DEAD_INVENTORY_IDS.includes(inv)
                ? 'это мёртвый слот (Charm1-3/Flask2-5 не экспортируются): игра молча отвергнет ВЕСЬ файл; удалите слот'
                : 'вне белого списка (Weapon1/2, Helm1, BodyArmour1, Gloves1, Boots1, Amulet1, Ring1/2, Belt1, Flask1): игра молча отвергнет ВЕСЬ файл'),
          );
        }
        const hasUnique = typeof unique === 'string' && unique.trim();
        const hasText = typeof text === 'string' && text.trim();
        if (!hasUnique && !hasText) {
          errors.push(`${label}: нет ни unique_name, ни additional_text — слот не описан`);
        }
        if (hasUnique && hasText) {
          warnings.push(`${label}: unique_name и additional_text вместе — конвенция: уники только имя, рары только текст`);
        }
        // Гейт №721 (живая сверка): незнакомое unique_name игра отвергает
        // молча — ВЕСЬ файл. Промах по каталогу = error-тон, но текст честен:
        // каталог kit'а ≠ полный список игры (может отставать: новые уники
        // патча, предметы вне PoB2-каталога). Каталог недоступен →
        // проверка пропускается (гейт — опциональный канон).
        if (hasUnique) {
          const catalog = knownUniqueNames();
          const uname = String(unique);
          if (catalog && !catalog.has(uname.trim().toLowerCase())) {
            errors.push(
              `${label}.unique_name «${uname}» не найден в каталоге уников kit'а — игра, вероятно, ` +
                'молча отвергнет ВЕСЬ файл (кейс №721). Проверь EN-имя по клир-тексту предмета (RU-имена игра не ' +
                'принимает — экспортируй на EN-клиенте); учти: каталог может быть неполным (реальные уники вне ' +
                'каталога существовали — кейс Aul\u2019s Dominance №721) — если предмет точно есть в игре, ' +
                'проверь точное написание имени',
            );
          }
        }
        if ('level_interval' in slot && !isLevelInterval(slot.level_interval)) {
          errors.push(`${label}.level_interval — пара чисел [min, max]`);
        }
      });
    }
  }

  // passives: slug-строки или {id}.
  if ('passives' in b) {
    const ps = b.passives;
    if (!Array.isArray(ps)) {
      errors.push('passives — массив');
    } else {
      if (ps.length === 0) warnings.push('passives пуст — билд без узлов (валидно)');
      ps.forEach((p, i) => {
        if (passiveId(p) === undefined) {
          errors.push(`passives[${i}]: нет id (ожидается slug-строка или {id})`);
        }
      });
    }
  }

  // skills: {id: Metadata/Items/Gems/…, support_skills: [...]}; сегмент
  // Gems/Gem непоследователен в реальных данных — shape мягкий.
  if ('skills' in b) {
    const sk = b.skills;
    if (!Array.isArray(sk)) {
      errors.push('skills — массив');
    } else {
      if (sk.length === 0) warnings.push('skills пуст — билд без камней (валидно)');
      sk.forEach((s, i) => {
        const label = `skills[${i}]`;
        if (typeof s !== 'object' || s === null) {
          errors.push(`${label} — объект`);
          return;
        }
        const skill = s as Record<string, unknown>;
        if (typeof skill.id !== 'string' || !skill.id.trim()) {
          errors.push(`${label}.id — непустая строка (Metadata-путь камня)`);
        } else {
          const id = skill.id;
          // Гейт №717 (живая сверка): игра жёстко валидирует id по gameId из
          // Gems.lua; НЕ-каноничный id НЕ убивает файл — у гема красные «?»
          // и он не работает. Поэтому warning, не error. Идёт ДО префикс-чекa:
          // datasetKey и gameId оба живут в Metadata/Items/Gems/…,
          // префикс не отличает их друг от друга.
          const known = knownGameIds();
          const dict = loadGameIds();
          if (known.size > 0 && !known.has(id)) {
            const viaKey = dict && dict[id] !== undefined && !gameIdValues().has(id) ? dict[id] : undefined;
            warnings.push(
              viaKey
                ? `${label}.id «${id}» — это datasetKey Gems.lua, а НЕ gameId: переименован в 0.5.x → используй «${viaKey}» (канон gem_gameids.json, №717); иначе у камня будут красные «?»`
                : `${label}.id «${id}» не входит в gameId-канон (gem_gameids.json, №717) — у камня будут красные «?»; без канонического id (поле gameId Gems.lua PoB2-клона) игра не загрузит камень`,
            );
          }
          if (!/^Metadata\/Items\/Gem/.test(id)) {
            warnings.push(`${label}.id «${id}» вне конвенции Metadata/Items/Gems/…`);
          }
        }
        if ('level_interval' in skill && !isLevelInterval(skill.level_interval)) {
          errors.push(`${label}.level_interval — пара чисел [min, max]`);
        }
        const sup = skill.support_skills;
        if (!Array.isArray(sup)) {
          errors.push(`${label}.support_skills — массив`);
          return;
        }
        sup.forEach((x, j) => {
          const ok =
            (typeof x === 'string' && x.trim()) ||
            (typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).id === 'string');
          if (!ok) errors.push(`${label}.support_skills[${j}]: строка или {id}`);
          else {
            // №717: саппорты валидируются игрой по тому же gameId-канону.
            const sid = typeof x === 'string' ? x : String((x as Record<string, unknown>).id);
            const known = knownGameIds();
            const dict = loadGameIds();
            if (known.size > 0 && !known.has(sid)) {
              const viaKey = dict && dict[sid] !== undefined ? dict[sid] : undefined;
              warnings.push(
                viaKey
                  ? `${label}.support_skills[${j}] «${sid}» — datasetKey, а не gameId: используй «${viaKey}» (№717)`
                  : `${label}.support_skills[${j}] «${sid}» вне gameId-канона (№717) — саппорт не загрузится`,
              );
            }
          }
        });
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Есть ли код (в любом регистре) среди значений ascendancies.json. */
function ascendancyCodeExists(code: string): boolean {
  try {
    return [...ascendancyCodes().values()].some((c) => c.toLowerCase() === code.toLowerCase());
  } catch {
    return false;
  }
}

// ─── TODO (следующие итерации, НЕ реализовано) ───────────────────────────────
// 1. ✅ Закрыто (E7, №451): level_interval на активных гемах — требование
//    ступени гема из датасета (skill_gems_v2 levels[].levelRequirement);
//    саппортам/неизвестным гемам поле честно не пишется.
// 2. weapon_set на пассивках: dual weapon-set деревья (passiveSelectionSet1/2
//    — только в API GGG self-экспорте, в PoB-коде их нет).
// 3. Jewels: формат только помечает jewel-слот аннотацией, placement невозможен.
// 4. Multi-stage прогрессия: серия .build по уровням (leveling-дорожка).
// 5. MCP-тул poe2_export_build_planner (ввод: код/ссылка; вывод: JSON+файл)
//    — отдельная итерация поверх этого модуля.
