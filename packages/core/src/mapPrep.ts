/**
 * №234 «Map Prep Assistant» — модель угрозы карты и чек-лист подготовки,
 * SPEC_MAP_PREP.md §4 (Этап 2). Данные — датасеты Этапа 1 (не менять):
 *  - data/game/maps/maps.json — 135 карт из PoB2 WorldAreas.lua (MIT);
 *  - data/game/maps/waystone_mods.json — 74 группы waystone-модов (PoB2).
 *
 * Отклонения от SPEC, признанные данными Этапа 1 (135 < ≥140 в гейте):
 *  - карт 135 (WorldAreas.lua после фильтра пиннакл-арен/хайдоутов);
 *  - у групп модов 3 ступени (low/medium/high), а не 4 (map_key_highest
 *    в экстракторе не представлен);
 *  - of Exposure = −(0 / 5–8 / 9–12)% «to ALL maximum Resistances» —
 *    минус ко ВСЕМ резистам, не −3–4% к одному элементу (SPEC F5 уточнён).
 *
 * Дисциплина verified (SPEC §2): каждый механизм класифицируется ТОЛЬКО по
 * stat_text_en; что не выражается моделью MapThreat — честный threat:null
 * в matchedMods (информация без выдуманного эффекта). Пороги maxroll
 * (chaos-резист по тирам) помечаются unverified до датамайн-подтверждения.
 *
 * Фаза 1 (SPEC §8): пул трэша (monster_varieties) — ТОЛЬКО информация,
 * без инференса элементов по именам монстров.
 */

import { ENEMY_CONSTANTS } from './enemy.js';
import type { BossMode } from './enemy.js';
import { waystoneAreaLevel } from './endgame.js';
import { getMapEntries, getWaystoneModGroups } from './dataset.js';
import type { MapEntry, WaystoneModGroup } from './dataset.js';
import { DEFENSE_CONSTANTS, identifyDefenseGaps } from './ehp.js';
import type { DefensiveStats } from './ehp.js';

// ─── Модель угрозы (SPEC §4.1) ────────────────────────────────────────────────

export type ThreatElement = 'fire' | 'cold' | 'lightning' | 'chaos' | 'physical';

/** Эффект мода на игрока. SPEC-набор расширен honest-программами из stat_text. */
export type PlayerDebuffEffect =
  | 'max_res'        // of Exposure: −X% to all maximum Resistances
  | 'recovery'      // of Smothering: −X% Recovery Rate of Life and ES
  | 'flask'         // of Drought: −X% Flask Charges gained
  | 'regen_block'   // of Stasis: cannot Regenerate Life, Mana or ES
  | 'leech_block'   // of Congealment: monsters cannot be Leeched from
  | 'defence_reduction' // of Rust (armour/block), of Miring (spell suppression)
  | 'slow'          // Maim (of Carnage) / Hinder (of Impedance)
  | 'marked'        // (зарезервировано SPEC; в датасете 0.5 такого мода нет)
  | 'unknown';      // механизм понятен, но не выражается Modellю — см. note

export interface MapPlayerDebuff {
  /** id группы мода из waystone_mods.json. */
  fromMod: string;
  effect: PlayerDebuffEffect;
  value?: number;
  /** EN stat text для нечисловых/составных эффектов (не выдумываем пересказ). */
  note?: string;
}

export interface ModThreat {
  kind: 'player_debuff' | 'monster_res' | 'element_weight';
  effect?: PlayerDebuffEffect;
  element?: ThreatElement;
  value?: number;
  note?: string;
}

/** Смэтченный мод: группа + ступень + значения + квалификация угрозы. */
export interface MatchedMod {
  mod: string;        // id группы из waystone_mods.json ('of_exposure')
  name: string;       // name_en ('of Exposure')
  kind: 'prefix' | 'suffix';
  /** Индекс ступени в tiers; -1 = ступень не распознана ( Numbers не сошлись). */
  tierIndex: number;
  /** values смэтченной ступени из датасета (undefined у статических модов). */
  values?: unknown;
  /** Числа, извлечённые из вставленной строки (для точных значений). */
  parsedNumbers: number[];
  /** Квалификация угрозы; null = механизм не выражается моделью (не выдумываем). */
  threat: ModThreat | null;
}

export interface MapThreat {
  area_level: number;
  boss: { name?: string; res: { ele: number; chaos: number }; kind: BossMode };
  monsterEleBonus?: number;
  monsterChaosRes?: number;
  playerDebuffs: MapPlayerDebuff[];
  /** Веса 0..100 ТОЛЬКО от подтверждённых модов (элементный урон/грунт), SPEC §4.1. */
  elements?: Partial<Record<ThreatElement, number>>;
  /** Пул трэша карты — только информация (SPEC §8), БЕЗ инференса элементов. */
  monsterVarieties: string[];
  biomes: string[];
  unverifiedNotes: string[];
  matchedMods: MatchedMod[];
  /** Вставленные строки, которые не сматчились ни по stat_text, ни по имени. */
  unknownMods: string[];
}

export interface MapThreatInput {
  /** id ('MapRustbowl') или EN-имя ('Rustbowl', 'Rustbowl (Map)') — регистронезависимо. */
  map?: string;
  /** Моды как в игре: полная строка stat_text или имя ('of Exposure'). */
  mods: string[];
  /** Waystone-тир 1–16 → area level 65..80 (verified poe2db, endgame.ts). */
  tier?: number;
}

// ─── Каталог угроз: id → квалификация по stat_text_en (все 74 группы) ─────────
//
// Каждый id квалифицирован честно ПО ТЕКСТУ СТАТА датасета. null = механизм
// известен, но не выражается моделью MapThreat (попадает в matchedMods как
// информация; в SPEC-поля НЕ тянем). Никаких эффектов свыше stat_text_en.

const PLAYER_DEBUFF = (effect: PlayerDebuffEffect, note?: string) => (): ModThreat | null =>
  ({ kind: 'player_debuff', effect, note });

const ELEMENT_WEIGHT = (element: ThreatElement) => (): ModThreat | null =>
  ({ kind: 'element_weight', element });

const MONSTER_RES = (): ModThreat | null => ({ kind: 'monster_res' });

/**
 * Каталог: функция получает разобранные значения ступени и возвращает threat.
 * value вычисляется на этапе агрегации (max пары/числа), здесь — только тип.
 */
const THREAT_CATALOG: Record<string, (args: { values?: unknown; nums: number[] }) => ModThreat | null> = {
  // ── Суффиксы, бьющие по игроку (SPEC §1 F5: опасные для подготовки) ──
  of_exposure: PLAYER_DEBUFF('max_res'),          // −X% to ALL maximum Resistances
  of_smothering: PLAYER_DEBUFF('recovery'),       // −X% Recovery Rate of Life and ES
  of_drought: PLAYER_DEBUFF('flask'),             // −X% Flask Charges gained
  of_stasis: PLAYER_DEBUFF('regen_block'),        // cannot Regenerate Life/Mana/ES
  of_congealment: PLAYER_DEBUFF('leech_block'),  // cannot be Leeched from
  of_rust: PLAYER_DEBUFF('defence_reduction'),   // less Armour + reduced Block
  of_miring: PLAYER_DEBUFF('defence_reduction'), // inc. Accuracy + −Suppression Prevented
  of_carnage: PLAYER_DEBUFF('slow'),              // Maim on Hit with Attacks
  of_impedance: PLAYER_DEBUFF('slow'),            // Hinder on Hit with Spells
  of_fatigue: PLAYER_DEBUFF('unknown', 'Players have X% less Cooldown Recovery Rate'),
  of_transience: PLAYER_DEBUFF('unknown', 'Buffs on Players expire X% faster'),
  of_doubt: PLAYER_DEBUFF('unknown', 'Players have X% reduced effect of Non-Curse Auras'),
  of_imprecision: PLAYER_DEBUFF('unknown', 'Players have X% less Accuracy Rating'),
  of_blinding: PLAYER_DEBUFF('unknown', 'Monsters Blind on Hit'),
  // ── Суффиксы/грунт-элементы: флаг без числового значения — вес-эвристика ──
  conflagrating: ELEMENT_WEIGHT('fire'),    // All Monster Damage from Hits always Ignites
  of_flames: ELEMENT_WEIGHT('fire'),       // patches of Burning Ground
  of_ice: ELEMENT_WEIGHT('cold'),           // patches of Chilled Ground
  of_lightning: ELEMENT_WEIGHT('lightning'),// Shocked Ground: +20% Damage taken
  of_venom: ELEMENT_WEIGHT('chaos'),        // Monsters Poison on Hit
  // ── Префиксы: элементный экстра-урон монстров (числовые веса) ──
  burning: ELEMENT_WEIGHT('fire'),          // +X% extra Physical as Fire
  freezing: ELEMENT_WEIGHT('cold'),         // ...as Cold
  shocking: ELEMENT_WEIGHT('lightning'),    // ...as Lightning
  profane: ELEMENT_WEIGHT('chaos'),         // ...as Extra Chaos ( + Withered)
  // ── Резисты монстров ──
  resistant: MONSTER_RES,                    // +X% Monster Ele Res, +Y% Chaos Res (F4)
};

/** Вес элементных модов без числового значения (грунт/флаги) — эвристика SPEC §2. */
export const MAP_ELEMENT_FLAG_WEIGHT = 30;

/** Кап резистов босса карты (enemy.ts, канон PoB2 ConfigOptions.lua:2035). */
const BOSS_ELE_RES = ENEMY_CONSTANTS.BOSS_ELEMENTAL_RES.boss;

// ─── Нормализация и разбор строк модов ────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Канонизация живых строк игры к форме датасета (и наоборот):
 * - игра пишет «-(9-12)%», PoB2-датасет — «minus (9 to 12)%» → унифицируем оба в «minus (…)»;
 * - «minus 10%» == «-10%» без скобок;
 * - переводы строк — в пробелы (многострочный стат vs вставка).
 * Применяется ОБЕИМ сторонам (вход и stat_text_en) — несимметрично нельзя.
 */
function canon(s: string): string {
  return norm(s)
    .replace(/-\s*\(/g, 'minus (')
    .replace(/\bminus\s*\(/g, 'minus (')
    .replace(/\bminus\s+(?=\d)/g, '-');
}

function extractNumbers(s: string): number[] {
  const out: number[] = [];
  // Диапазоны «(X to Y)» / «(X-Y)» — числа ПОЛОЖИТЕЛЬНЫЕ: внутренний дефис —
  // синтаксис диапазона, не знак минуса (игра пишет «-(7-8)%» = minus 7 to 8).
  for (const m of s.matchAll(/\(\s*(\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(\d+(?:\.\d+)?)\s*\)/g)) {
    out.push(parseFloat(m[1]), parseFloat(m[2]));
  }
  const stripped = s
    .replace(/\(\s*\d+(?:\.\d+)?\s*(?:to|-|–|—)\s*\d+(?:\.\d+)?\s*\)/g, ' ')
    .replace(/\d+(?:\.\d+)?\s+to\s+\d+(?:\.\d+)?/g, ' ');
  for (const m of stripped.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(parseFloat(m[0]));
  return out;
}

/** Ограничения ступени: каждое value — число (точка) или [min,max] (диапазон). */
interface TierConstraint { min: number; max: number }

/**
 * Ограничения из stat_text_en ступени (канонично и однозначно): «(X to Y)» /
 * «(X-Y)» → диапазон, одиночные числа → точки. values в датасете неоднороден
 * (голый скаляр/массив/пары) и НИКОГДА не заменяет текст.
 */
function tierConstraintsFromText(statTextEn: string): TierConstraint[] {
  const out: TierConstraint[] = [];
  let rest = statTextEn;
  for (const m of statTextEn.matchAll(/\((\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\)/g)) {
    out.push({ min: parseFloat(m[1]), max: parseFloat(m[2]) });
    rest = rest.replace(m[0], ' ');
  }
  for (const m of rest.matchAll(/\d+(?:\.\d+)?/g)) {
    const v = parseFloat(m[0]);
    out.push({ min: v, max: v });
  }
  return out;
}

/** Max конечного числа среди values (глубоко, values может быть скаляром). */
function tierMaxValue(raw: unknown): number | null {
  let max: number | null = null;
  const walk = (v: unknown): void => {
    if (typeof v === 'number' && Number.isFinite(v)) max = max == null || v > max ? v : max;
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(raw);
  return max;
}

/**
 * Regex ступени: stat_text_en с подстановкой чисел — «(X to Y)» и «(Y)»
 * дают ОДИН generic-паттерн `\(\d+( to \d+)?\)`, одиночные числа → `\d+`.
 * Спец-символы экранируются, пробелы → `\s+` (матч «contains»).
 */
function tierRegex(statTextEn: string): RegExp {
  const tokenized = statTextEn
    .replace(/\((\d+(?:\.\d+)?)\s+(?:to|-)\s+(\d+(?:\.\d+)?)\)/g, '\u0000R\u0000')
    .replace(/\((\d+(?:\.\d+)?)\)/g, '\u0000S\u0000')
    .replace(/\d+(?:\.\d+)?/g, '\u0000N\u0000');
  const escaped = tokenized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\u0000R\u0000/g, '\\(\\s*\\d+(?:\\.\\d+)?(?:\\s*(?:to|-)\\s*\\d+(?:\\.\\d+)?)?\\s*\\)')
    .replace(/\u0000S\u0000/g, '\\(\\s*\\d+(?:\\.\\d+)?\\s*\\)')
    .replace(/\u0000N\u0000/g, '\\d+(?:\\.\\d+)?')
    .replace(/\s+/g, '\\s+');
  return new RegExp(pattern, 'i');
}

// ─── Матчинг мода ─────────────────────────────────────────────────────────────

interface ModMatch { mod: WaystoneModGroup; tierIndex: number; nums: number[] }

/**
 * Ступень по числам вставленной строки: каждая цифра должна попасть в один
 * из constraint'ов СТАТ-ТЕКСТА ступени («(X to Y)» — диапазон, одиночные — точки).
 * Неоднозначно/невозможно → -1 (worst-case: последняя ступень датасета,
 * помечается unverifiedNote на уровне mapThreat).
 */
function resolveTier(mod: WaystoneModGroup, nums: number[]): number {
  if (!nums.length) return -1;
  const fits: number[] = [];
  for (let i = 0; i < mod.tiers.length; i++) {
    const cons = tierConstraintsFromText(mod.tiers[i]?.stat_text_en ?? '');
    if (!cons.length) continue;
    if (nums.every((n) => cons.some((c) => n >= c.min && n <= c.max))) fits.push(i);
  }
  // Однозначный матч — единственный fits; неоднозначный — младшая ступень.
  return fits.length ? fits[0]! : -1;
}

/** Матч одной вставленной строки: (1) stat_text contains, (2) fallback name_en. */
function matchMod(input: string): ModMatch | null {
  const ni = canon(input);
  if (!ni) return null;
  const nums = extractNumbers(input);

  // (1) stat_text_en с числовой подстановкой. Образцы ступени:
  //     (а) полный текст (переводы строк — пробелы после canon);
  //     (б) отдельные СЫРЫЕ строки до canon — игра выдаёт статы двухстрочных
  //         модов по одной («+24% Monster Elemental Resistances» без chaos-строки).
  //     Специфичность = длина смэтченного образца, лучшая группа побеждает.
  let best: WaystoneModGroup | null = null;
  let bestSpecificity = 0;
  for (const mod of getWaystoneModGroups()) {
    for (const tier of mod.tiers) {
      const rawLines = tier.stat_text_en.split('\n').map((l) => l.trim()).filter((l) => l.length >= 12);
      const samples = [canon(tier.stat_text_en), ...rawLines.map((l) => canon(l))];
      let matchedLen = 0;
      for (const sample of samples) {
        try {
          if (sample.length >= 12 && sample.length > matchedLen && tierRegex(sample).test(ni)) {
            matchedLen = sample.length;
          }
        } catch {
          // некорректный паттерн не должен ронять матчинг — пропускаем образец
        }
      }
      if (matchedLen > bestSpecificity) {
        best = mod;
        bestSpecificity = matchedLen;
      }
    }
  }
  if (best) return { mod: best, tierIndex: resolveTier(best, nums), nums };

  // (2) fallback: имя группы ('of Exposure').
  for (const mod of getWaystoneModGroups()) {
    const nn = norm(mod.name_en);
    if (nn && ni.includes(nn)) {
      return { mod, tierIndex: resolveTier(mod, nums), nums };
    }
  }
  return null;
}

// ─── Квалификация смэтченного мода (value по данным ступени/строки) ───────────

function resolveMatchedTier(m: ModMatch): { tierIndex: number; tierText: string; values?: unknown } {
  const tierIndex = m.tierIndex >= 0 ? m.tierIndex : m.mod.tiers.length - 1; // worst-case
  const tier = m.mod.tiers[tierIndex];
  return { tierIndex, tierText: tier?.stat_text_en ?? '', values: tier?.values };
}

function classifyMatched(m: ModMatch): { matched: MatchedMod; debuff?: MapPlayerDebuff; unverified?: string } {
  const { values, tierIndex, tierText } = resolveMatchedTier(m);
  const cat = THREAT_CATALOG[m.mod.id];
  let threat: ModThreat | null = null;
  let debuff: MapPlayerDebuff | undefined;
  let unverified: string | undefined;
  if (cat) threat = cat({ values, nums: m.nums });

  // value: prefer числа из вставленной строки (реальный ролл), иначе max значений ступени.
  const valueOf = (): number | undefined => {
    const cons = tierConstraintsFromText(tierText);
    const fitNums = m.nums.filter((n) => cons.some((c) => n >= c.min && n <= c.max));
    if (fitNums.length) return Math.max(...fitNums);
    return tierMaxValue(values) ?? undefined;
  };

  if (threat?.kind === 'player_debuff') {
    debuff = { fromMod: m.mod.id, effect: threat.effect! };
    const v = valueOf();
    if (v !== undefined && threat.effect !== 'regen_block' && threat.effect !== 'leech_block') {
      debuff.value = v;
    }
    if (threat.note) debuff.note = threat.note;
  }

  if (m.tierIndex < 0 && m.mod.tiers.length > 1 && tierMaxValue(m.mod.tiers[tierIndex]?.values) != null) {
    unverified = `ступень мода «${m.mod.name_en}» не распознана по числам (взята худшая из датасета; ограничение: 3 ступени в данных Этапа 1)`;
  }

  return {
    matched: {
      mod: m.mod.id,
      name: m.mod.name_en,
      kind: m.mod.kind,
      tierIndex,
      values,
      parsedNumbers: m.nums,
      threat,
    },
    debuff,
    unverified,
  };
}

// ─── Поиск карты ──────────────────────────────────────────────────────────────

function normMapName(s: string): string {
  return norm(s).replace(/\s*\(map\)\s*$/, '');
}

function findMap(query: string): MapEntry | null {
  const q = normMapName(query);
  for (const m of getMapEntries()) {
    if (m.id.toLowerCase() === q) return m;
    if (normMapName(m.name_en) === q) return m;
  }
  return null;
}

/** Ближайшие имена по префиксу (для честной ошибки «не найдено»). */
function suggestMapNames(query: string, limit = 5): string[] {
  const q = normMapName(query);
  const names = getMapEntries().map((m) => normMapName(m.name_en));
  const prefix = q.slice(0, Math.min(4, Math.max(2, q.length)));
  const byPrefix = names.filter((n) => n.startsWith(prefix)).slice(0, limit);
  return byPrefix.length ? byPrefix : names.slice(0, limit);
}

// ─── mapThreat ────────────────────────────────────────────────────────────────

export function mapThreat(input: MapThreatInput): MapThreat {
  const unverifiedNotes: string[] = [];
  const matchedMods: MatchedMod[] = [];
  const unknownMods: string[] = [];
  const playerDebuffs: MapPlayerDebuff[] = [];
  const elements: Partial<Record<ThreatElement, number>> = {};
  let monsterEleBonus: number | undefined;
  let monsterChaosRes: number | undefined;

  // Уровень зоны: тир (verified poe2db) > базовый уровень карты из датасета.
  let map: MapEntry | null = null;
  let areaLevel: number;
  if (input.map != null && input.map !== '') {
    map = findMap(input.map);
    if (!map) {
      const suggestions = suggestMapNames(input.map).join('", "');
      throw new Error(`Карта не найдена: «${input.map}». Ближайшие по префиксу: "${suggestions}"`);
    }
  }
  if (input.tier != null) {
    const lvl = waystoneAreaLevel(input.tier);
    if (lvl == null) throw new Error(`Неверный waystone-тир: ${input.tier} (ожидается целое 1–16)`);
    areaLevel = lvl;
  } else if (map) {
    areaLevel = map.area_level;
  } else {
    areaLevel = 65;
    unverifiedNotes.push('карта не указана — взят базовый уровень зоны 65 (T1)');
  }

  // Моды: матч по stat_text/имени → каталог угроз; неизвестные — честно в unknownMods.
  for (const raw of input.mods ?? []) {
    const matched = matchMod(raw);
    if (!matched) {
      unknownMods.push(raw);
      continue;
    }
    const { matched: mm, debuff, unverified } = classifyMatched(matched);
    matchedMods.push(mm);
    if (unverified) unverifiedNotes.push(unverified);
    if (debuff) playerDebuffs.push(debuff);

    const t = mm.threat;
    const tierText = matched.mod.tiers[mm.tierIndex]?.stat_text_en ?? '';
    if (t?.kind === 'monster_res') {
      // resistant: «+X% Elemental … +Y% Chaos» — порядок чисел по stat_text.
      const cons = tierConstraintsFromText(tierText);
      const fitAll = matched.nums.filter((n) => cons.some((c) => n >= c.min && n <= c.max));
      const ele = fitAll[0] ?? cons[0]?.min ?? 0;
      const chaos = fitAll[1] ?? cons[1]?.min ?? 0;
      monsterEleBonus = Math.min(75, (monsterEleBonus ?? 0) + ele);   // кап монстр-резов 75 (F6)
      monsterChaosRes = Math.min(75, (monsterChaosRes ?? 0) + chaos);
    } else if (t?.kind === 'element_weight' && t.element) {
      // Вес пропорционален значению мода ПРОТИВ tiers: экстра-урон — первый
      // диапазон стат-текста («(21 to 25)% … 100 seconds» → 25, не «секунды»).
      const cons = tierConstraintsFromText(tierText);
      const c0 = cons[0];
      const fit = c0 ? matched.nums.filter((n) => n >= c0.min && n <= c0.max) : [];
      const v = fit.length ? Math.max(...fit) : c0 ? c0.max : undefined;
      const w = v === undefined ? MAP_ELEMENT_FLAG_WEIGHT : Math.min(100, Math.max(0, v));
      elements[t.element] = Math.min(100, (elements[t.element] ?? 0) + w);
      if (v === undefined) {
        unverifiedNotes.push(
          `мод «${mm.name}»: элемент-флаг без числового значения — вес ${MAP_ELEMENT_FLAG_WEIGHT} есть ЭВРИСТИКА (SPEC §2)`,
        );
      }
    }
  }

  // Босс карты: резисты из канона enemy.ts (Boss = +30% ele, 0 chaos); статы
  // боссов карт не скейлятся с тирами (SPEC F3). Пустые boss_varieties — дыра
  // источника PoB2: НЕ выдумываем имя.
  const bossNames = map?.boss_varieties ?? [];
  const boss: MapThreat['boss'] = {
    res: { ele: BOSS_ELE_RES, chaos: 0 },
    kind: 'boss',
  };
  if (bossNames.length) {
    boss.name = bossNames.join(', ');
  } else if (map) {
    unverifiedNotes.push('босс карты неизвестен (дыра источника PoB2: boss_varieties пуст)');
  }

  const threat: MapThreat = {
    area_level: areaLevel,
    boss,
    playerDebuffs,
    matchedMods,
    unknownMods,
    monsterVarieties: map?.monster_varieties ?? [],
    biomes: map?.biomes ?? [],
    unverifiedNotes,
  };
  if (monsterEleBonus !== undefined) threat.monsterEleBonus = monsterEleBonus;
  if (monsterChaosRes !== undefined) threat.monsterChaosRes = monsterChaosRes;
  const hasWeights = Object.keys(elements).length > 0;
  if (hasWeights) threat.elements = elements;
  if (threat.monsterVarieties.length) {
    unverifiedNotes.push(
      `пул трэша карты (${threat.monsterVarieties.length} разновидностей) передан информационно — инференс элементов по именам НЕ выполняется (SPEC §8)`,
    );
  }
  return threat;
}

// ─── Чек-лист подготовки (SPEC §4.2, паттерн pinnacleChecklist) ────────────────

export interface MapPrepCheck {
  /** Ключ-идентификатор, ascii: 'chaos_res_for_area_level_70'. */
  check: string;
  passed: boolean;
  /** 0..10. */
  severity: number;
  advice_ru: string;
  unverified?: boolean;
}

/**
 * Порог chaos-резиста по уровню зоны — maxroll-эталон (SPEC §2: verified:false
 * до датамайн-подтверждения): 40–50% к T6+ (area 70+), ~75% к T11+ (area 75+).
 */
export function requiredChaosRes(areaLevel: number): { value: number; unverified: true } {
  if (areaLevel >= 75) return { value: 75, unverified: true };
  if (areaLevel >= 70) return { value: 40, unverified: true };
  return { value: 0, unverified: true };
}

function clampSeverity(x: number): number {
  return Math.max(0, Math.min(10, x));
}

/**
 * Персональный вердикт подготовки к карте: резисты (с учётом Exposure-капов),
 * пороги chaos по уровню зоны (maxroll, unverified), кастомные чеки по
 * playerDebuffs, мерж с ehp.identifyDefenseGaps. Read-only по входам.
 */
export function mapPrepChecklist(stats: DefensiveStats, threat: MapThreat): MapPrepCheck[] {
  const checks: MapPrepCheck[] = [];
  const cap = DEFENSE_CONSTANTS.RESISTANCE_DEFAULT_CAP;
  const maxResDebuff = Math.max(
    0,
    ...threat.playerDebuffs.filter((d) => d.effect === 'max_res').map((d) => d.value ?? 0),
  );

  // 1) Элем-резисты. Приоритет — элементы с весами угрозы; босс карты своим
  //    элементом НЕ детерминирован датасетом (F9) → дополнительно сравниваем
  //    ВСЕ элем-резисты с базовым капом (босс_elements_неизвестны → DEFAULT).
  const weights = threat.elements ?? {};
  const elemRows: Array<{ key: 'fire' | 'cold' | 'lightning'; stat: number | undefined; label: string }> = [
    { key: 'fire', stat: stats.fireRes, label: 'fire' },
    { key: 'cold', stat: stats.coldRes, label: 'cold' },
    { key: 'lightning', stat: stats.lightningRes, label: 'lightning' },
  ];
  for (const e of elemRows) {
    const val = e.stat ?? 0;
    const required = cap - maxResDebuff;
    const passed = val >= required;
    const weight = weights[e.key] ?? 0;
    const deficit = Math.max(0, required - val);
    let severity = clampSeverity(deficit / 5 + (weight > 0 ? Math.min(4, weight / 25) : 0));
    if (!passed && weight === 0 && deficit < 5) severity = clampSeverity(deficit / 5);
    checks.push({
      check: `${e.label}_res_for_area_level_${threat.area_level}`,
      passed,
      severity,
      advice_ru: passed
        ? `${e.label} ${val}% ≥ требуемых ${required}% — ок${weight > 0 ? ` (элемент-угроза карты, вес ${weight})` : ''}`
        : `Добей ${e.label} до ${required}%${maxResDebuff > 0 ? ` (Exposure: −${maxResDebuff}% к капу ${cap}%)` : ''}` +
          `${weight > 0 ? ` — мод карты даёт ${e.label}-угрозу (вес ${weight})` : ''}. ` +
          `Фикс: Essence-суффикс (Insulation/Thawing/Grounding) или резист-руна.`,
    });
  }

  // 2) Chaos: порог по уровню зоны (maxroll, unverified); отрицательный — всегда fail.
  const chaosReq = requiredChaosRes(threat.area_level);
  const chaosVal = stats.chaosRes ?? 0;
  const chaosTarget = Math.max(0, chaosReq.value);
  const chaosPassed = chaosVal >= chaosTarget && chaosVal >= 0;
  checks.push({
    check: `chaos_res_for_area_level_${threat.area_level}`,
    passed: chaosPassed,
    severity: clampSeverity(Math.max(0, chaosTarget - chaosVal) / 5 + (chaosVal < 0 ? 3 : 0)),
    advice_ru:
      (chaosPassed
        ? `chaos ${chaosVal}% ≥ порога ${chaosReq.value}% (maxroll, level ${threat.area_level})`
        : `Поднять chaos с ${chaosVal}% до ${chaosTarget}% (порог maxroll для area level ${threat.area_level})`) +
      ' — порог НЕ верифицирован датамайном',
    unverified: true,
  });

  // 3) Кастомные чеки по playerDebuffs (SPEC §4.2).
  for (const d of threat.playerDebuffs) {
    switch (d.effect) {
      case 'max_res':
        // уже учтено в elem-чеках (кап −X); отдельная информационная строка.
        checks.push({
          check: 'exposure_max_res_compensation',
          passed: true,
          severity: clampSeverity(2 + (d.value ?? 0) / 4),
          advice_ru: `of Exposure: −${d.value ?? '?'}% ко ВСЕМ максимальным резистам → рабочий кап ${cap - (d.value ?? 0)}%. Требуемые резисты уже скорректированы в чеках выше${(d.value ?? 0) >= 9 ? ' — сильный мод: рассмотри переролл камня, если резисты впритык' : ''}.`,
        });
        break;
      case 'recovery':
        checks.push({
          check: 'smothering_recovery',
          passed: false,
          severity: clampSeverity(2 + (d.value ?? 0) / 10),
          advice_ru: `of Smothering: −${d.value ?? '?'}% Recovery Rate Life/ES. Автопроверка regen/leech по DefensiveStats НЕВОЗМОЖНА (нет поля) — сверь PoB: входящий реген < ожидаемого урона — не заходи впритык по HP.`,
          unverified: true,
        });
        break;
      case 'flask':
        checks.push({
          check: 'drought_flask_charges',
          passed: false,
          severity: clampSeverity(3 + (d.value ?? 0) / 10),
          advice_ru: `of Drought: −${d.value ?? '?'}% зарядов фляг. Возьми фляги с «+charges gained» / Charm-слоты; планируй меньше фарма фляжных зарядов на этой карте.`,
        });
        break;
      case 'regen_block':
        checks.push({
          check: 'stasis_no_regen',
          passed: false,
          severity: 8,
          advice_ru: 'of Stasis: реген Life/Mana/ES полностью отключён. Всё восстановление — ТОЛЬКО фляги; CI/ES-билдам особенно больно (реберз ES не работает).',
        });
        break;
      case 'leech_block':
        checks.push({
          check: 'congealment_no_leech',
          passed: false,
          severity: 7,
          advice_ru: 'of Congealment: лилить с монстров нельзя. Билдам на личе — уповать на фляги/реген; оцени переролл камня.',
        });
        break;
      case 'defence_reduction':
        checks.push({
          check: 'defence_reduction_mod',
          passed: false,
          severity: clampSeverity(3 + (d.value ?? 0) / 10),
          advice_ru: `Мод ${d.fromMod} ослабляет оборону (−${d.value ?? '?'}%: армор/блок или spell suppression${d.note ? `; ${d.note}` : ''}). Учти в PoB и держи запас по EHP.`,
        });
        break;
      case 'slow':
        checks.push({
          check: 'movement_slow_on_hit',
          passed: false,
          severity: clampSeverity(3 + (d.value ?? 0) / 10),
          advice_ru: `Мод ${d.fromMod}: монстры вешают slow (Maim/Hinder${d.note ? `; ${d.note}` : ''}). Требует мобилити — проверь источники Temple of Snow/уклонение от АоЕ.`,
        });
        break;
      default:
        checks.push({
          check: `debuff_${d.fromMod}`,
          passed: false,
          severity: 3,
          advice_ru: `Мод ${d.fromMod} бьёт по игроку${d.note ? ` (${d.note})` : ''}${d.value != null ? `, −${d.value}%` : ''}. Механизм известен, но автоматическая проверкa обороны по нему не построена — оцени вручную.`,
          unverified: true,
        });
    }
  }

  // 4) Мерж с ehp.identifyDefenseGaps (verified-формулы) — топ-6 по severity.
  //    Дедуп-фильтр: uncapped_*_resistance уже покрыты шагами 1–2 (с поправкой
  //    Exposure) — иначе каждый элемент получал бы два конфликтуующих совета
  //    (добить до 75% и до 68%). Остальные гэпы (армор/пулы/уклонение) — все.
  const resGapTypes = new Set([
    'uncapped_fire_resistance',
    'uncapped_cold_resistance',
    'uncapped_lightning_resistance',
    'uncapped_chaos_resistance',
  ]);
  for (const gap of identifyDefenseGaps(stats).filter((g) => !resGapTypes.has(g.gapType)).slice(0, 6)) {
    checks.push({
      check: `defense_gap_${gap.gapType}`,
      passed: false,
      severity: clampSeverity(gap.severity),
      advice_ru: gap.recommendation,
    });
  }

  return checks.sort((a, b) => b.severity - a.severity);
}

// ─── Markdown-экспорт (SPEC §4.3, паттерн keybindsToMarkdown) ─────────────────

/** Сводка угрозы карты в markdown (секции SPEC §4.3). */
export function mapPrepAdvice(stats: DefensiveStats, threat: MapThreat): string {
  const lines: string[] = [];
  const bossLine = threat.boss.name ? threat.boss.name : 'неизвестен (дыра источника)';
  lines.push(`## Подготовка к карте (area level ${threat.area_level})`);
  lines.push('');
  lines.push(`**Босс:** ${bossLine} — элем-резист ${threat.boss.res.ele}%, chaos ${threat.boss.res.chaos}%, режим ${threat.boss.kind}.`);
  if (threat.monsterVarieties.length) {
    lines.push(`**Пул трэша:** ${threat.monsterVarieties.length} разновидностей (информационно, без инференса элементов).`);
  }
  lines.push('');

  const danger = threat.matchedMods.filter((m) => m.threat);
  if (danger.length) {
    lines.push('**⚠ Моды, требующие подготовки:**');
    for (const m of danger) {
      const t = m.threat!;
      const v = t.value ?? tierMaxValue(m.values);
      const desc =
        t.kind === 'player_debuff' ? `эффект на игроке: ${t.effect}${v != null ? ` −${v}%` : ''}` :
        t.kind === 'monster_res' ? `резисты монстров +${threat.monsterEleBonus ?? '?'}% элем / +${threat.monsterChaosRes ?? '?'}% chaos` :
        `${t.element}-угроза, вес ${threat.elements?.[t.element!] ?? '?'}`;
      lines.push(`- ${m.name} (ступень ${m.tierIndex + 1}): ${desc}.`);
    }
    lines.push('');
  }

  const failed = mapPrepChecklist(stats, threat).filter((c) => !c.passed || c.severity >= 3);
  if (failed.length) {
    lines.push('**Пробелы обороны (что добить):**');
    for (const c of failed) {
      lines.push(`- ${c.advice_ru}${c.unverified ? ' ⚠️ unverified' : ''} (severity ${c.severity.toFixed(1)})`);
    }
    lines.push('');
  }

  const bring: string[] = [];
  if (threat.playerDebuffs.some((d) => d.effect === 'flask')) bring.push('фляги с +charges gained (of Drought)');
  if (threat.playerDebuffs.some((d) => d.effect === 'regen_block' || d.effect === 'leech_block' || d.effect === 'recovery')) {
    bring.push('запасные фляги/Charms — реген и лиич под ударом');
  }
  if ((threat.monsterEleBonus ?? 0) > 0 || (threat.monsterChaosRes ?? 0) > 0) {
    bring.push(`элем-DPS с запасом: у монстров +${threat.monsterEleBonus ?? 0}% элем / +${threat.monsterChaosRes ?? 0}% chaos резист`);
  }
  if (bring.length) {
    lines.push('**Что взять с собой:**');
    lines.push(...bring.map((b) => `- ${b}`));
    lines.push('');
  }

  if (threat.unknownMods.length) {
    lines.push(`**❓ Не распознанные моды (проверь вручную):** ${threat.unknownMods.join(' | ')}.`);
    lines.push('');
  }
  if (threat.unverifiedNotes.length) {
    lines.push('**⚠️ Unverified-пункты:**');
    lines.push(...threat.unverifiedNotes.map((n) => `- ${n}`));
  }
  return lines.join('\n');
}
