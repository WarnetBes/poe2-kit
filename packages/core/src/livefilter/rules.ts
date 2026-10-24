/**
 * Live-price loot filter: снапшот цен + генератор динамического блока правил
 * (P3, этап B — №281-W2).
 *
 * Перенос идей и микроархитектуры из mrw-overlay-poe2 (MIT):
 * Copyright (c) kadircelebi / mrw-overlay-poe2, MIT — snapshot.go:20-95
 * (schema), rules.go:23-29 (guardrails), rules.go:45-163 (builder/styles),
 * rules.go:184-300+ (GenerateDynamicFilterBlock). Go→TS — переписывание,
 * атрибуция этой строкой.
 *
 * Invariants:
 *  - Всё в Exalted Orb (self-describing snapshot, snapshot.go:19-29).
 *  - Порядок групп критичен: first-match-wins (§3.1 плана, rules.go:184-189):
 *    stack → always-show → divine → value tiers → uniques → exceptional →
 *    слайдеры (waystones/uncut gems) → скрытие ниже порога.
 *  - Guardrails «minimum evidence before HIDE» (rules.go:23-29): показ мусора
 *    стоит взгляда, скрытие ценного — потери вещи. Скрытие уника/exceptional
 *    требует минимум листингов/семплов.
 *  - Uncut gems и waystones — по слайдерам уровня (GemLevel/WaystoneTier),
 *    НЕ по цене (rules.go:734,758-774).
 *  - Сериализация блоков — через livefilter/conditions.ts (ordering).
 */

import { serializeBlock, type FilterBlock, type FilterCondition } from './conditions.js';

// ─── Guardrails (rules.go:17-29, MIT — константы перенесены) ────────────────

/** Чанк значений в одном правиле — строки не длиннее разумного. */
export const DEFAULT_CHUNK_SIZE = 15;

/** Потолок авто-стеков: валюта, которой для порога нужно больше, не прячется стеком. */
export const MAX_AUTO_STACK = 50;

/** Минимум листингов уника-базы, чтобы её можно было СКРЫТЬ (не показ). */
export const MIN_UNIQUE_LISTINGS_TO_HIDE = 3;

/** Минимум листингов exceptional-базы, чтобы её можно было СКРЫТЬ. */
export const MIN_EXCEPTIONAL_LISTINGS_TO_HIDE = 10;

/** Минимум использованных семплов цены exceptional-базы для скрытия. */
export const MIN_EXCEPTIONAL_SAMPLES_TO_HIDE = 3;

export const LIVE_FILTER_SCHEMA_VERSION = 1;

// ─── Снапшот (порт schema snapshot.go:20-95, MIT) ──────────────────────────

/** Курсы к Exalted: цена 1 divine / 1 chaos в exalts. */
export interface LiveFilterRates {
  divineEx: number;
  chaosEx: number;
}

/** Стакуемое (валюта, руны, эссенции…): цена за штуку в exalts. */
export interface CurrencyPrice {
  name: string;
  apiId?: string;
  category: string;
  valueEx: number;
  listings?: number;
}

export interface UniquePrice {
  name: string;
  category: string;
  valueEx: number;
  listings: number;
}

/**
 * Уник-база: лут-фильтр видит только базу неопознанного уника — база стоит
 * как самый дорогой уник на ней (ceiling, snapshot.go:46-52).
 */
export interface UniqueBase {
  topName: string;
  maxEx: number;
  uniques: UniquePrice[];
}

export type ExceptionalKind = 'sockets' | 'quality';

/** Exceptional ordinary-rarity base: больше сокетов/качества, чем роллит класс. */
export interface ExceptionalPrice {
  base: string;
  class?: string;
  kind: ExceptionalKind;
  min: number;
  minIlvl?: number;
  maxIlvl?: number;
  valueEx: number;
  listings: number;
  samples: number;
  scannedAt?: string;
}

/** Статус апстрим-источника в снапшоте (упавший источник = наследуемый prev). */
export interface SourceStatus {
  ok: boolean;
  fetchedAt?: string;
  error?: string;
}

/** Самодостаточный снапшот цен одной лиги (все значения — exalts). */
export interface LiveFilterSnapshot {
  schemaVersion: number;
  league: string;
  generatedAt: string;
  rates: LiveFilterRates;
  currency: CurrencyPrice[];
  uniqueBases: Record<string, UniqueBase>;
  exceptional: ExceptionalPrice[];
  sources: Record<string, SourceStatus>;
}

/** Ошибки валидации; пустая строка = снапшот пригоден (порт snapshot.go:98-112). */
export function validateSnapshot(s: LiveFilterSnapshot | null | undefined): string {
  if (!s) return 'пустой снапшот';
  if (s.schemaVersion !== LIVE_FILTER_SCHEMA_VERSION) {
    return `неподдерживаемая schema_version ${s.schemaVersion} (ожидалась ${LIVE_FILTER_SCHEMA_VERSION})`;
  }
  if (!(s.rates?.divineEx > 0)) return 'нет курса divine';
  if (s.currency.length === 0 && Object.keys(s.uniqueBases ?? {}).length === 0) {
    return 'нет данных о ценах';
  }
  return '';
}

// ─── Конфиг генератора (MVP одного value-tier; группы — v2) ────────────────

export interface LiveFilterConfig {
  /** Порог ценности в exalts: выше — показ с подсветкой, ниже — кандидат на скрытие. */
  thresholdEx: number;
  /** Личный always-show (BaseTypes), НИКОГДА не скрывается (группа 3). */
  alwaysShow?: string[];
  /**
   * Цели билда (§3.5 плана, этап F): генератор добавляет Show-правила для
   * нужных билду баз/модов — «что билд ищет апгрейдом, никогда не прячется».
   * НЕ hardcoded: данные приходят снаружи (сериализуемый конфиг).
   * Прохождение через SelfCheck обязательно (unknown база → правило дропнуто).
   */
  buildTargets?: LiveFilterBuildTargets;
  /** Слайдер: показывать uncut gems только >= уровня (группа 9). */
  uncutGemMinLevel?: number;
  /** Слайдер: показывать waystones только >= тира (группа 9). */
  waystoneMinTier?: number;
  /** Скрывать Normal/Magic гир-классы ниже порога (группа 10, default true). */
  hideLowRarityGear?: boolean;
}

/**
 * Цели билда для build-aware-правил (§3.5 этап F): ничего не выдумываем —
 * условия только из каталога conditions.json. Сопротивления (resistances)
 * фильтр НЕ умеет выражать («resist >= X» нет в каталоге) — поле хранится
 * как метаданные для UI/будущего sourcing, в правила НЕ транслируется.
 */
export interface LiveFilterBuildTargets {
  /** Носимые/целевые базы билда: Show с exact BaseType (чанки по DEFAULT_CHUNK_SIZE). */
  baseTypes?: string[];
  /** Целевые моды: Show с exact HasExplicitMod. Требует проверки в игре. */
  hasExplicitMods?: string[];
  /** Интересные resistance-типы — метаданные (фильтром не выражаются). */
  resistances?: Array<'fire' | 'cold' | 'lightning' | 'chaos'>;
  /** ItemLevel-пол для целей (ItemLevel >= N в каждом build-aware Show). */
  minIlvl?: number;
  /** Происхождение targets — метаданные provenance (не влияют на FilterKey). */
  source?: 'pob' | 'manual';
}

/**
 * Известные игре множества для канонизации (этап C: датасет + NS-парсер).
 * Если не переданы — канонизация пропускается (все имена принимаются).
 */
export interface KnownFilterSets {
  classes: ReadonlySet<string>;
  bases: ReadonlySet<string>;
}

// ─── Stats (порт rules.go:32-43) ───────────────────────────────────────────

export interface LiveFilterStats {
  thresholdEx: number;
  valuableCurrency: number;
  cheapCurrency: number;
  valuableUniqueBases: number;
  cheapUniqueBases: number;
  valuableExceptional: number;
  cheapExceptional: number;
  stackRules: number;
  droppedRules: number;
  /** Сгенерированных build-aware правил (группа 3.5, этап F). */
  buildAwareRules: number;
  warnings: string[];
}

// ─── Styles (паттерн rules.go:45-163 — своя реализация значений) ──────────

interface RuleStyle {
  font?: number;
  text?: string;
  border?: string;
  bg?: string;
  beam?: string;
  icon?: string;
}

const STYLE_DIVINE: RuleStyle = { font: 45, beam: 'Cyan', icon: '0 Cyan Star' };
const STYLE_VALUABLE: RuleStyle = {
  font: 40, text: '240 220 255 255', border: '180 120 255 255', bg: '70 20 100 230',
  icon: '1 Purple Diamond',
};
const STYLE_UNIQUE: RuleStyle = {
  font: 44, text: '255 255 255 255', border: '255 100 0 255', bg: '175 40 0 255',
  beam: 'Red', icon: '0 Red Star',
};
const STYLE_EXCEPTIONAL: RuleStyle = {
  font: 42, text: '255 255 255 255', border: '0 210 255 255', bg: '0 40 70 240',
  beam: 'Cyan', icon: '1 Cyan Diamond',
};
const STYLE_WAYSTONE: RuleStyle = {
  font: 42, text: '255 255 255 255', border: '255 0 0 255', bg: '120 0 0 240',
  beam: 'Red', icon: '1 Red Square',
};
const STYLE_GEM: RuleStyle = {
  font: 42, text: '80 255 160 255', border: '0 255 130 255', bg: '5 50 20 255',
  beam: 'Green', icon: '1 Green Triangle',
};
const STYLE_KEEP: RuleStyle = { font: 38, text: '235 235 235 255', border: '150 150 160 255', bg: '30 30 34 230' };
const STYLE_DIM: RuleStyle = { font: 18, text: '120 120 120 180', bg: '0 0 0 150' };
/** Build-aware (этап F): цели билда — зелёный луч, заметнее always-show. */
const STYLE_BUILD: RuleStyle = {
  font: 42, text: '150 255 200 255', border: '60 220 130 255', bg: '10 60 35 235',
  beam: 'Green', icon: '0 Green Star',
};

/** Гир-классы (эквипмент без джевелов/флаконов), rules.go:166-170 — факты имён. */
const GEAR_CLASSES = [
  'Amulets', 'Belts', 'Body Armours', 'Boots', 'Bows', 'Bucklers', 'Crossbows',
  'Foci', 'Gloves', 'Helmets', 'One Hand Maces', 'Quarterstaves', 'Quivers', 'Rings',
  'Sceptres', 'Shields', 'Spears', 'Staves', 'Talismans', 'Two Hand Maces', 'Wands',
];

// ─── Хелперы ──────────────────────────────────────────────────────────────

const MAX_FONT = 45;

function clampFont(f: number): number {
  return Math.max(18, Math.min(MAX_FONT, f));
}

/** Перенос строки, пробравшийся в имя значения, не может начать свою строку (rules.go:60-65). */
function sanitizeLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0))];
}

function styleActions(st: RuleStyle | undefined): { command: string; args: string }[] {
  if (!st) return [];
  const a: { command: string; args: string }[] = [];
  if (st.font) a.push({ command: 'SetFontSize', args: String(clampFont(st.font)) });
  if (st.text) a.push({ command: 'SetTextColor', args: st.text });
  if (st.border) a.push({ command: 'SetBorderColor', args: st.border });
  if (st.bg) a.push({ command: 'SetBackgroundColor', args: st.bg });
  if (st.beam) a.push({ command: 'PlayEffect', args: st.beam });
  if (st.icon) a.push({ command: 'MinimapIcon', args: st.icon });
  return a;
}

/** «Uncut Spirit Gem (Level 20)» → 20 (паттерн parseUncutGem, rules.go:514). */
export function parseUncutGemLevel(name: string): number | null {
  const m = /^Uncut .*? Gem \(Level (\d+)\)$/.exec(name.trim());
  return m ? Number(m[1]) : null;
}

function baseTypeCond(names: string[], chunkSize: number): FilterCondition[] {
  return chunk(names, chunkSize).map(
    (part): FilterCondition => ({
      kind: 'list', name: 'BaseType', op: '==', exact: true,
      values: part.map(sanitizeLine),
    }),
  );
}

interface BuildCtx {
  cfg: LiveFilterConfig;
  snap: LiveFilterSnapshot;
  known: KnownFilterSets | undefined;
  stats: LiveFilterStats;
  blocks: FilterBlock[];
}

/** Канонизация имени базы против known-set (dropped ≠ trim: правило выкидывается целиком). */
function canonBase(ctx: BuildCtx, name: string): string | null {
  if (!ctx.known) return name;
  return ctx.known.bases.has(name) ? name : null;
}

function addBlock(ctx: BuildCtx, block: FilterBlock): void {
  ctx.blocks.push(block);
}

// ─── Генератор (порт GenerateDynamicFilterBlock, rules.go:184+) ───────────

export interface GeneratedFilterBlock {
  text: string;
  stats: LiveFilterStats;
}

/**
 * Сгенерировать динамический блок «# [[DYNAMIC LOOT FILTER]] … # [[END DYNAMIC LOOT FILTER]]»
 * по снапшоту. Чистая функция: snapshot+cfg → текст+stats; без диска и сети.
 *
 * Degenerate cases честны: пустые выборки не прячутся (guardrails), slain
 * источник = inherited prev (только фиксируется в stats.warnings).
 */
export function generateDynamicBlock(
  snap: LiveFilterSnapshot,
  cfg: LiveFilterConfig,
  known?: KnownFilterSets,
): GeneratedFilterBlock {
  const err = validateSnapshot(snap);
  if (err) throw new Error(`livefilter: снапшот непригоден: ${err}`);

  const thr = cfg.thresholdEx;
  const stats: LiveFilterStats = {
    thresholdEx: thr, valuableCurrency: 0, cheapCurrency: 0,
    valuableUniqueBases: 0, cheapUniqueBases: 0, valuableExceptional: 0,
    cheapExceptional: 0, stackRules: 0, droppedRules: 0, buildAwareRules: 0, warnings: [],
  };
  const ctx: BuildCtx = { cfg, snap, known, stats, blocks: [] };

  // Самокотировка: Divine/Chaos стоят ровно свой курс (не листинг другого источника,
  // races-гэп ронял Divine из «1 divine»-тира — rules.go:263-273).
  const selfRate: Record<string, number> = {};
  if (snap.rates.divineEx > 0) selfRate['Divine Orb'] = snap.rates.divineEx;
  if (snap.rates.chaosEx > 0) selfRate['Chaos Orb'] = snap.rates.chaosEx;

  // ── классификация валюты ──
  const valuableCur: string[] = [];
  const cheapCur: Array<{ name: string; unitEx: number }> = [];
  const gemLevels = new Set<number>();
  for (const c of snap.currency) {
    const gem = parseUncutGemLevel(c.name);
    if (gem !== null) {
      // Uncut gem — не по цене, по уровню; ценный — в свой tier-Show с GemLevel
      if (c.valueEx >= thr) gemLevels.add(gem);
      continue;
    }
    const canon = canonBase(ctx, c.name);
    if (!canon) { stats.warnings.push(`валюта вне known-баз: ${c.name}`); continue; }
    const value = selfRate[canon] ?? c.valueEx;
    if (value >= thr) {
      valuableCur.push(canon);
      stats.valuableCurrency++;
    } else {
      cheapCur.push({ name: canon, unitEx: value });
      stats.cheapCurrency++;
    }
  }

  // ── уники: база = ceiling всех уников на ней ──
  const valuableUniqueBases: string[] = [];
  const hideableUniqueBases: string[] = [];
  for (const [base, ub] of Object.entries(snap.uniqueBases ?? {})) {
    const canon = canonBase(ctx, base);
    if (!canon) { stats.warnings.push(`уник-база вне known-баз: ${base}`); continue; }
    const top = ub.uniques.reduce((b, u) => (u.listings > 0 && u.valueEx > b ? u.valueEx : b), 0) || ub.maxEx;
    const topListings = ub.uniques.reduce((b, u) => (u.valueEx >= top - 1e-9 ? Math.max(b, u.listings) : b), 0);
    if (top >= thr) {
      valuableUniqueBases.push(canon);
      stats.valuableUniqueBases++;
    } else if (topListings >= MIN_UNIQUE_LISTINGS_TO_HIDE) {
      // guardrail (rules.go:26): минимум листингов у топ-уника базы,
      // иначе скрытие на пустой выборке = потеря вещи.
      hideableUniqueBases.push(canon);
      stats.cheapUniqueBases++;
    }
  }

  // ── exceptional: ItemLevel-бакеты 79-81 / 82+, grouped по kind+min ──
  const mapEx = new Map<string, string[]>();
  const hideEx = new Set<string>();
  for (const e of snap.exceptional ?? []) {
    const canon = canonBase(ctx, e.base);
    if (!canon) { stats.warnings.push(`exceptional вне known-баз: ${e.base}`); continue; }
    if (e.valueEx >= thr) {
      stats.valuableExceptional++;
      const bucketId = `${e.kind}|${e.min}|${e.minIlvl ?? 0}|${e.maxIlvl ?? 0}`;
      mapEx.set(bucketId, [...(mapEx.get(bucketId) ?? []), canon]);
    } else {
      // guardrail: listings >= 10 И samples >= 3 (rules.go:27-28)
      if (e.listings >= MIN_EXCEPTIONAL_LISTINGS_TO_HIDE && e.samples >= MIN_EXCEPTIONAL_SAMPLES_TO_HIDE) {
        hideEx.add(canon);
        stats.cheapExceptional++;
      }
    }
  }

  // ═══= ПОРЯДОК ГРУПП = first-match-wins (§3.1) =═══

  // 1. Авто-стеки: N = ceil(threshold / unitPrice), потолок MAX_AUTO_STACK.
  //    «Скорее показываем чаще, чем скрываем» (§3.2): правило Show, не Hide.
  const stackGroup: string[] = [];
  for (const c of cheapCur) {
    if (c.unitEx <= 0) continue;
    const n = Math.ceil(thr / c.unitEx);
    if (n > MAX_AUTO_STACK) continue; // слишком дешёвая — стеком не спасти, прячем целиком ниже
    if (n <= 1) continue; // дороже порога юнитом — уже в valuable
    addBlock(ctx, {
      type: 'Show',
      comment: `auto-stack: ${c.name} x${n} ≈ ${thr.toFixed(1)} ex`,
      conditions: [
        { kind: 'list', name: 'BaseType', op: '==', exact: true, values: [c.name] },
        { kind: 'numeric', name: 'StackSize', op: '>=', value: n },
      ],
      actions: styleActions(STYLE_KEEP),
    });
    stats.stackRules++;
    stackGroup.push(c.name);
  }
  const cheapExStack = new Set(stackGroup);

  // 2. Exotic bases — нет источника данных в MVP (§3.1), пропущено.
  // 3. Always-show whitelist — НИКОГДА не скрывается.
  const alwaysShow = uniq(cfg.alwaysShow ?? []);
  if (alwaysShow.length > 0) {
    addBlock(ctx, {
      type: 'Show',
      comment: 'always-show (personal)',
      conditions: baseTypeCond(alwaysShow, DEFAULT_CHUNK_SIZE),
      actions: styleActions(STYLE_KEEP),
    });
  }

  // 3.5 Build-aware (§3.5 плана, этап F): цели билда — Show-правила для
  // нужных билду баз/модов. До value tiers: first-match-wins, цель билда
  // не должна быть перекрыта ценовыми группами ниже И не должна попасть
  // в Hide-группы (гир, носимый билдом = кандидат на апгрейд).
  // Условия — ТОЛЬКО из каталога conditions.json: BaseType exact,
  // HasExplicitMod exact, ItemLevel >=. Resistances фильтром не выражаются.
  const targets = cfg.buildTargets;
  const buildMinIlvl = targets?.minIlvl && targets.minIlvl > 0 ? targets.minIlvl : null;
  const buildBasesRaw = uniq(targets?.baseTypes ?? []);
  const buildBases: string[] = [];
  for (const b of buildBasesRaw) {
    const canon = canonBase(ctx, b);
    if (!canon) { stats.warnings.push(`build target вне known-баз (правило дропнуто): ${b}`); continue; }
    buildBases.push(canon);
  }
  if (buildBases.length > 0) {
    const conds = baseTypeCond(buildBases, DEFAULT_CHUNK_SIZE);
    if (buildMinIlvl !== null) conds.push({ kind: 'numeric', name: 'ItemLevel', op: '>=', value: buildMinIlvl });
    addBlock(ctx, {
      type: 'Show',
      comment: `build-aware bases${buildMinIlvl !== null ? ` (ilvl >= ${buildMinIlvl})` : ''}`,
      conditions: conds,
      actions: styleActions(STYLE_BUILD),
    });
    stats.buildAwareRules++;
  }
  const buildMods = uniq(targets?.hasExplicitMods ?? []).map(sanitizeLine);
  if (buildMods.length > 0) {
    const modConds = chunk(buildMods, DEFAULT_CHUNK_SIZE).map(
      (part): FilterCondition => ({
        kind: 'list', name: 'HasExplicitMod', op: '==', exact: true,
        values: part,
      }),
    );
    if (buildMinIlvl !== null) modConds.push({ kind: 'numeric', name: 'ItemLevel', op: '>=', value: buildMinIlvl });
    addBlock(ctx, {
      type: 'Show',
      comment: `build-aware mods${buildMinIlvl !== null ? ` (ilvl >= ${buildMinIlvl})` : ''}`,
      conditions: modConds,
      actions: styleActions(STYLE_BUILD),
    });
    stats.buildAwareRules++;
  }

  // 4. Divine spotlight — отдельный beam.
  if (snap.rates.divineEx > 0) {
    addBlock(ctx, {
      type: 'Show',
      comment: 'divine spotlight',
      conditions: [{ kind: 'list', name: 'BaseType', op: '==', exact: true, values: ['Divine Orb'] }],
      actions: styleActions(STYLE_DIVINE),
    });
  }

  // 5. Value tier: дорогая валюта (>= thr) — подсветка.
  const valuable = uniq(valuableCur);
  if (valuable.length > 0) {
    addBlock(ctx, {
      type: 'Show',
      comment: `value tier >= ${thr.toFixed(1)} ex (currency)`,
      conditions: baseTypeCond(valuable, DEFAULT_CHUNK_SIZE),
      actions: styleActions(STYLE_VALUABLE),
    });
  }

  // 6. Уник-базы >= порога: Rarity Unique + BaseType (rules.go:506,656).
  const uBases = uniq(valuableUniqueBases);
  if (uBases.length > 0) {
    addBlock(ctx, {
      type: 'Show',
      comment: 'valuable unique bases',
      conditions: [
        { kind: 'list', name: 'Rarity', op: '==', exact: true, values: ['Unique'] },
        ...baseTypeCond(uBases, DEFAULT_CHUNK_SIZE),
      ],
      actions: styleActions(STYLE_UNIQUE),
    });
  }
  // 6-скрытие: дешёвые уник-базы (guardrail listings) — ТОЛЬКО после показа всех ценных.
  const hideUB = uniq(hideableUniqueBases);
  if (hideUB.length > 0) {
    addBlock(ctx, {
      type: 'Hide',
      comment: `cheap unique bases (>= ${MIN_UNIQUE_LISTINGS_TO_HIDE} listings)`,
      conditions: [
        { kind: 'list', name: 'Rarity', op: '==', exact: true, values: ['Unique'] },
        ...baseTypeCond(hideUB, DEFAULT_CHUNK_SIZE),
      ],
      actions: [],
    });
  }

  // 7. Chance bases — механики PoE2-MVP нет; пропущено (честная граница, не фича-флаг).
  // 8. Exceptional: sockets/quality по бакетам ilvl.
  for (const [bucketId, bases] of mapEx) {
    const [kind, minStr, minIlvl, maxIlvl] = bucketId.split('|');
    const conds: FilterCondition[] = [
      ...baseTypeCond(uniq(bases), DEFAULT_CHUNK_SIZE),
    ];
    conds.unshift({
      kind: 'numeric', name: kind === 'sockets' ? 'Sockets' : 'Quality',
      op: '>=', value: Number(minStr),
    });
    const lo = Number(minIlvl);
    const hi = Number(maxIlvl);
    if (lo > 0) conds.unshift({ kind: 'numeric', name: 'ItemLevel', op: '>=', value: lo });
    if (hi > 0) conds.unshift({ kind: 'numeric', name: 'ItemLevel', op: '<=', value: hi });
    conds.unshift({ kind: 'list', name: 'Rarity', op: '==', exact: true, values: ['Normal'] });
    addBlock(ctx, {
      type: 'Show',
      comment: `exceptional ${kind} >= ${minStr}${lo > 0 ? ` ilvl ${lo}${hi > 0 ? '-' + hi : '+'}` : ''}`,
      conditions: conds,
      actions: styleActions(STYLE_EXCEPTIONAL),
    });
  }
  // exceptional-скрытие: дешёвые exceptional базы скрывать НЕЛЬЗЯ конкретной базой
  // (фильтр не видит сокеты до идентификации) — только не показывать подсветку;
  // донор решает сканером; в MVP прячем как ordinary bases без подсветки — no-op.
  void hideEx;

  // 9. Слайдеры waystones/uncut gems — по уровню, НЕ по цене (rules.go:734,758-774).
  // Ценные uncut gems (>= порога) — Show с GemLevel == N, СТРОГО в группе 9,
  // до любых Hide (first-match-wins).
  const gemMin = cfg.uncutGemMinLevel ?? 0;
  const levels = [...gemLevels].sort((a, b) => a - b);
  for (const lvl of levels) {
    addBlock(ctx, {
      type: 'Show',
      comment: `valuable uncut gems (level ${lvl})`,
      conditions: [
        { kind: 'list', name: 'Class', op: '==', exact: true, values: ['Uncut Gems'] },
        { kind: 'numeric', name: 'GemLevel', op: '==', value: lvl },
      ],
      actions: styleActions(STYLE_VALUABLE),
    });
  }
  if (gemMin > 0) {
    addBlock(ctx, {
      type: 'Show',
      comment: `uncut gems >= level ${gemMin}`,
      conditions: [
        { kind: 'list', name: 'Class', op: '==', exact: true, values: ['Uncut Gems'] },
        { kind: 'numeric', name: 'GemLevel', op: '>=', value: gemMin },
      ],
      actions: styleActions(STYLE_GEM),
    });
    addBlock(ctx, {
      type: 'Hide',
      comment: 'uncut gems below slider',
      conditions: [
        { kind: 'list', name: 'Class', op: '==', exact: true, values: ['Uncut Gems'] },
        { kind: 'numeric', name: 'GemLevel', op: '<', value: gemMin },
      ],
      actions: [],
    });
  }
  const wayMin = cfg.waystoneMinTier ?? 0;
  if (wayMin > 0) {
    addBlock(ctx, {
      type: 'Show',
      comment: `waystones >= tier ${wayMin}`,
      conditions: [
        { kind: 'list', name: 'Class', op: '==', exact: true, values: ['Waystones'] },
        { kind: 'numeric', name: 'WaystoneTier', op: '>=', value: wayMin },
      ],
      actions: styleActions(STYLE_WAYSTONE),
    });
    addBlock(ctx, {
      type: 'Hide',
      comment: 'waystones below slider',
      conditions: [
        { kind: 'list', name: 'Class', op: '==', exact: true, values: ['Waystones'] },
        { kind: 'numeric', name: 'WaystoneTier', op: '<', value: wayMin },
      ],
      actions: [],
    });
  }

  // 10. Скрытие ниже порога.
  // (а) дешёвая валюта, которую не спас авто-стек;
  // (б) blanket-скрытие Normal/Magic гира (конвенция strict-фильтров).
  const hideCur = cheapCur.filter((c) => !cheapExStack.has(c.name)).map((c) => c.name);
  const hideCurU = uniq(hideCur).filter((n) => n !== 'Divine Orb');
  if (hideCurU.length > 0) {
    addBlock(ctx, {
      type: 'Hide',
      comment: 'cheap currency below threshold (too cheap to stack)',
      conditions: baseTypeCond(hideCurU, DEFAULT_CHUNK_SIZE),
      actions: [],
    });
  }
  if ((cfg.hideLowRarityGear ?? true) && known?.classes) {
    // Прячем только КЛАССЫ из известного множества — unknown класс = молчаливый
    // reject всего фильтра (selfcheck.go:9-15).
    const gear = GEAR_CLASSES.filter((g) => known!.classes.has(g));
    if (gear.length > 0) {
      addBlock(ctx, {
        type: 'Hide',
        comment: 'low-rarity gear (Normal/Magic)',
        conditions: [
          { kind: 'list', name: 'Rarity', op: '', exact: false, values: ['Normal', 'Magic'] },
          { kind: 'list', name: 'Class', op: '==', exact: true, values: gear },
        ],
        actions: [],
      });
    }
  }
  // Uncut gems ценный tier: GemLevel == N, не цена (rules.go:514) — вставлены в группе 9 выше.

  // ── Сборка текста: маркер-обёртка + блоки (сериализация через conditions.ts) ──
  const lines: string[] = [
    '#==============================================================================',
    '# [[DYNAMIC LOOT FILTER]] — generated by poe2-kit livefilter',
    `# league: ${sanitizeLine(snap.league)}; generated: ${sanitizeLine(snap.generatedAt)};`,
    `# threshold: ${thr} ex; divine: ${snap.rates.divineEx} ex; schema ${LIVE_FILTER_SCHEMA_VERSION}`,
    '#==============================================================================',
  ];
  for (const b of ctx.blocks) {
    lines.push(...serializeBlock(b), '');
  }
  lines.push(
    '#==============================================================================',
    '# [[END DYNAMIC LOOT FILTER]]',
    '#==============================================================================',
  );
  return { text: lines.join('\n'), stats };
}
