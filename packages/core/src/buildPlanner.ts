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

function gemMetadataId(name: string): string | undefined {
  const exact = loadMap().gem_name_to_metadata[name];
  if (exact) return exact;
  // PoB иногда пишет nameSpec с вариативным суффиксом римской ступени
  // («Rapid Attacks», «Fire Attunement») — пробуем I-ю ступень как fallback.
  const tiered = loadMap().gem_name_to_metadata[`${name} I`];
  if (tiered) return tiered;
  return undefined;
}

function isSupportName(name: string): boolean {
  const id = gemMetadataId(name);
  return id ? /SupportGem/.test(id) : /\sSupport$/i.test(name);
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
            sup.push(sid);
          }
        }
        out.push({ id, support_skills: sup });
      }
    }
  } else if (build.skills.length > 0) {
    // Групп нет (легаси-парсер) — плоский список имён без саппортов.
    for (const name of build.skills) {
      const id = gemMetadataId(name);
      if (!id) {
        unmapped.add(name);
        continue;
      }
      if (!seenSkill.has(id)) {
        seenSkill.add(id);
        out.push({ id, support_skills: [] });
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

/** PoB-слот (ItemSet/Slot name) → inventory_id из словаря формата. */
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
  'Flask 2': 'Flask2',
  'Flask 3': 'Flask3',
  'Flask 4': 'Flask4',
  'Flask 5': 'Flask5',
  'Charm 1': 'Charm1',
  'Charm 2': 'Charm2',
  'Charm 3': 'Charm3',
};

/** Строки клир-текста, которые НЕ являются модами (метаданные предмета). */
const NON_MOD_LINE = /^(rarity:|--------|item level:|requirements|.+\s\d+$)/i;

function convertInventory(items: BuildGearItem[], warnings: string[]): BuildPlannerInventorySlot[] {
  const out: BuildPlannerInventorySlot[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const inventoryId = SLOT_TO_INVENTORY[it.slot];
    if (!inventoryId) {
      warnings.push(`слот «${it.slot}» не входит в словарь inventory_id — предмет «${it.name}» пропущен`);
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
    const additional = [first, ...modLines.map((l, i) => `${i + 1}. ${l}`)].join('\n');
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

  const out: BuildPlannerBuild = {
    name: opts.name ?? [build.class, build.ascendancy].filter(Boolean).join(' — ') ?? 'Imported build',
  };
  if (!out.name) out.name = 'Imported build';
  if (opts.author) out.author = opts.author;
  if (opts.link) out.link = opts.link;
  if (opts.description) out.description = opts.description;
  if (ascendancy) out.ascendancy = ascendancy;
  if (passives.length > 0) out.passives = passives;
  if (skills.length > 0) out.skills = skills;

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

// ─── TODO (следующие итерации, НЕ реализовано) ───────────────────────────────
// 1. level_interval: гейтинг камней/предметов по уровню (нужны требования
//    уровней гема — есть в Gems.lua/датасете, но PoB-экспорт их не несёт;
//    сейчас резервируемся всем [1,100] — честнее не писать поле вовсе).
// 2. weapon_set на пассивках: dual weapon-set деревья (passiveSelectionSet1/2
//    — только в API GGG self-экспорте, в PoB-коде их нет).
// 3. Jewels: формат только помечает jewel-слот аннотацией, placement невозможен.
// 4. Multi-stage прогрессия: серия .build по уровням (leveling-дорожка).
// 5. MCP-тул poe2_export_build_planner (ввод: код/ссылка; вывод: JSON+файл)
//    — отдельная итерация поверх этого модуля.
