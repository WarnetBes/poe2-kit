/**
 * Датамдайн RePoE — бесплатные данные PoE2 (github-хостинг, JSON).
 * Кэшируются в памяти. Используется для:
 *  - базы предметов (базовые статы: амора, ES, EV, физ. урон, крит, требования)
 *  - тиров модов (префикс/суффикс) для оценки силы снаряжения
 *
 * @see https://repoe-fork.github.io/poe2/
 */

import { cachedJson, DEFAULT_TTLS } from './cache.js';

const REPOE_BASE = 'https://repoe-fork.github.io/poe2';

/** Базовый предмет с базовыми статами. */
export interface BaseItemStats {
  name: string;
  itemClass: string;
  tags: string[];
  baseEs: number | null;
  baseArmour: number | null;
  baseEvasion: number | null;
  basePhysDamageMin: number | null;
  basePhysDamageMax: number | null;
  baseCritChance: number | null;
  baseAttackTime: number | null;
  reqLevel: number | null;
  reqStr: number | null;
  reqDex: number | null;
  reqInt: number | null;
  dropLevel: number | null;
}

/** Результат матчинга тира мода. */
export interface ModTierResult {
  modText: string;
  value: number;
  tier: number;
  totalTiers: number;
  range: [number, number];
  bestTierAtIlvl: number | null;
  prefixSuffix: 'prefix' | 'suffix';
  affixName: string;
}

type BaseItemIndex = Map<string, BaseItemStats>;

interface RepoeBaseEntry {
  domain?: string;
  drop_level?: number;
  item_class?: string;
  name?: string;
  tags?: string[];
  release_state?: string;
  properties?: {
    armour?: { min?: number };
    energy_shield?: { min?: number };
    evasion?: { min?: number };
    physical_damage_min?: number;
    physical_damage_max?: number;
    critical_strike_chance?: number;
    attack_time?: number;
  };
  requirements?: { level?: number; strength?: number; dexterity?: number; intelligence?: number };
}

let baseItemIndex: BaseItemIndex | null = null;

/** Загрузить и заиндексировать базу предметов (лениво, один раз). */
async function ensureBaseItemIndex(): Promise<BaseItemIndex> {
  if (baseItemIndex) return baseItemIndex;
  const { data: raw } = await cachedJson<Record<string, RepoeBaseEntry>>(`${REPOE_BASE}/base_items.json`, {
    ttlMs: DEFAULT_TTLS.repoe,
  });
  const index: BaseItemIndex = new Map();
  for (const entry of Object.values(raw)) {
    if (entry.domain !== 'item' || !entry.name) continue;
    if (entry.release_state === 'unreleased') continue;
    const props = entry.properties;
    const reqs = entry.requirements;
    const stats: BaseItemStats = {
      name: entry.name,
      itemClass: entry.item_class ?? '',
      tags: entry.tags ?? [],
      baseEs: props?.energy_shield?.min ?? null,
      baseArmour: props?.armour?.min ?? null,
      baseEvasion: props?.evasion?.min ?? null,
      basePhysDamageMin: props?.physical_damage_min ?? null,
      basePhysDamageMax: props?.physical_damage_max ?? null,
      baseCritChance: props?.critical_strike_chance ? props.critical_strike_chance / 100 : null,
      baseAttackTime: props?.attack_time ? +(1000 / props.attack_time).toFixed(2) : null,
      reqLevel: reqs?.level ?? null,
      reqStr: reqs?.strength ?? null,
      reqDex: reqs?.dexterity ?? null,
      reqInt: reqs?.intelligence ?? null,
      dropLevel: entry.drop_level ?? null,
    };
    index.set(entry.name.toLowerCase(), stats);
  }
  baseItemIndex = index;
  return index;
}

/**
 * Найти базовый предмет по названию.
 * Для Magic-предметов, чьё название включает аффиксы (напр. "Gold Circlet of the Polar Bear"),
 * прогрессивно отрезает хвостовые слова, пока не найдёт точное имя базы.
 */
export async function lookupBaseItem(baseTypeName: string): Promise<BaseItemStats | null> {
  try {
    const index = await ensureBaseItemIndex();
    const exact = index.get(baseTypeName.toLowerCase());
    if (exact) return exact;
    const words = baseTypeName.split(/\s+/);
    for (let len = words.length - 1; len >= 2; len--) {
      const candidate = words.slice(0, len).join(' ').toLowerCase();
      const match = index.get(candidate);
      if (match) return match;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Моды (тиры) ───────────────────────────────────────────────────────

interface RepoeModEntry {
  domain?: string;
  generation_type?: string;
  name?: string;
  required_level?: number;
  spawn_weights?: Array<{ tag?: string; weight?: number }>;
  stats?: Array<{ min?: number; max?: number }>;
  text?: string | null;
  type?: string;
  groups?: string[];
  is_essence_only?: boolean;
}

interface IndexedModTier {
  template: string;
  affixName: string;
  generationType: 'prefix' | 'suffix';
  requiredLevel: number;
  statMin: number;
  statMax: number;
  type: string;
  groups: string[];
  allowedTags: Set<string>;
}

type ModIndex = Map<string, IndexedModTier[]>;

let modIndex: ModIndex | null = null;

/** Убрать RePoE-разметку из текста мода. */
function stripMarkup(text: string): string {
  return text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');
}

/** Нормализовать текст мода в шаблон: все числа (и диапазоны) заменяются на "#". */
function normalizeTemplate(text: string): string {
  return text
    .replace(/\([\d.]+-[\d.]+\)/g, '#')
    .replace(/[\d.]+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractFirstNumber(text: string): number | null {
  const match = text.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

async function ensureModIndex(): Promise<ModIndex> {
  if (modIndex) return modIndex;
  const { data: raw } = await cachedJson<Record<string, RepoeModEntry>>(`${REPOE_BASE}/mods.json`, {
    ttlMs: DEFAULT_TTLS.repoe,
  });
  const index: ModIndex = new Map();
  for (const mod of Object.values(raw)) {
    if (mod.domain !== 'item') continue;
    if (mod.generation_type !== 'prefix' && mod.generation_type !== 'suffix') continue;
    if (!mod.text || !mod.stats?.length) continue;
    if (mod.is_essence_only) continue;

    const cleanText = stripMarkup(mod.text);
    const template = normalizeTemplate(cleanText);
    if (!template || template === '#') continue;

    const allowedTags = new Set<string>();
    for (const sw of mod.spawn_weights ?? []) {
      if (sw.weight && sw.weight > 0 && sw.tag && sw.tag !== 'default') {
        allowedTags.add(sw.tag);
      }
    }
    if (allowedTags.size === 0) continue;

    const entry: IndexedModTier = {
      template,
      affixName: mod.name ?? '',
      generationType: mod.generation_type,
      requiredLevel: mod.required_level ?? 0,
      statMin: mod.stats[0]!.min ?? 0,
      statMax: mod.stats[0]!.max ?? 0,
      type: mod.type ?? '',
      groups: mod.groups ?? [],
      allowedTags,
    };
    const existing = index.get(template);
    if (existing) existing.push(entry);
    else index.set(template, [entry]);
  }
  modIndex = index;
  return index;
}

/**
 * Определить тир одного мода по его тексту.
 * Использует теги предмета и возвращает тир префикса/суффикса и лучший доступный на ilvl.
 */
export async function matchSingleModTier(
  modText: string,
  itemTags: string[],
  itemLevel: number | null,
): Promise<ModTierResult | null> {
  try {
    const index = await ensureModIndex();
    const template = normalizeTemplate(modText);
    const candidates = index.get(template);
    if (!candidates?.length) return null;

    const value = extractFirstNumber(modText);
    if (value === null) return null;

    const tagSet = new Set(itemTags);
    const compatible = candidates.filter((c) => {
      for (const tag of c.allowedTags) if (tagSet.has(tag)) return true;
      return false;
    });
    if (!compatible.length) return null;

    const byType = new Map<string, IndexedModTier[]>();
    for (const c of compatible) {
      const existing = byType.get(c.type);
      if (existing) existing.push(c);
      else byType.set(c.type, [c]);
    }

    for (const tiers of byType.values()) {
      const sorted = [...tiers].sort((a, b) => b.requiredLevel - a.requiredLevel);
      for (let i = 0; i < sorted.length; i++) {
        const tier = sorted[i]!;
        if (value >= tier.statMin && value <= tier.statMax) {
          let bestAtIlvl: number | null = null;
          if (itemLevel !== null) {
            const bestIdx = sorted.findIndex((t) => t.requiredLevel <= itemLevel);
            bestAtIlvl = bestIdx !== -1 ? bestIdx + 1 : null;
          }
          return {
            modText,
            value,
            tier: i + 1,
            totalTiers: sorted.length,
            range: [tier.statMin, tier.statMax],
            bestTierAtIlvl: bestAtIlvl,
            prefixSuffix: tier.generationType,
            affixName: tier.affixName,
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Определить тиры всех явных модов предмета. */
export async function matchAllModTiers(
  modTexts: string[],
  itemTags: string[],
  itemLevel: number | null,
): Promise<ModTierResult[]> {
  const results: ModTierResult[] = [];
  for (const modText of modTexts) {
    const r = await matchSingleModTier(modText, itemTags, itemLevel);
    if (r) results.push(r);
  }
  return results;
}