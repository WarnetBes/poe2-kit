/**
 * W4-2: gearscore предмета БЕЗ билда — SSF/левелинг: «насколько этот предмет
 * хорош сам по себе, до того как есть билд».
 *
 * Idea reference: poe2-upgrade-checker (GPL-3) gearscore.js — НИ СТРОКИ кода
 * не скопировано (№686/№687). Перенята эвристика (не охраняема):
 *   - профиль = список статов с важностью 0..10 ПО СЛОТАМ и «отличным
 *     роллом» (cap);
 *   - оценка = Σ(важность × качество ролла) / «идеальный предмет слота»
 *     (top-K статов профиля на полном ролле) → 0..100;
 *   - один стат не может набрать больше одного топ-ролла (implicit+explicit
 *     life не удваивают);
 *   - условные моды («if you've Hit Recently», «пока …», «за заряд …») ×0.6 —
 *     работают не всегда;
 *   - зачарованные/рунные бонусы ×0.5 (заменимые);
 *   - уже закрытые резисты (resNeed) почти не весят; недостатки — штраф;
 *   - bounded: Local Defence/DPS-моды не считаются поверх [Base];
 *   - фляги/чармы/уники/неопознанные — не оцениваются.
 *
 * Отличия от референса (свои решения): вход — наш ParsedItem (RU/EN клир-текст),
 * профили упрощены до двух generic (life-res UNNIVERSAL по умолчанию, es-caster),
 * слот выводится из itemClass, weapon DPS — наш расчёт по offense парсера.
 */

import { parseItemText, type ParsedItem, type ItemMod } from './parse.js';

// ═══ Контракты ═══════════════════════════════════════════════════════════

export type GearscoreProfileId = 'life-res' | 'es-caster';

export interface GearscoreContribution {
  key: string;
  label: string;
  value: number;
  /** качество ролла 0..115%. */
  qualityPct: number;
  points: number;
  source: ItemMod['type'];
}

export interface GearscoreResult {
  rated: boolean;
  unratedReason?: 'unique' | 'unidentified' | 'flask' | 'charm' | 'not-item';
  slot: string;
  profile: GearscoreProfileId;
  profileName: string;
  score: number | null;
  grade: string;
  /** Что дало очки (по убыванию). */
  contributions: GearscoreContribution[];
  /** Недостатки (минус-моды профилируемых статов). */
  penalties: GearscoreContribution[];
  /** Моды, которых профиль не ждёт в этом слоте (не.points ноль, инфо). */
  wasted: string[];
  /** Топ-3 отсутствующих важ precious стата (что докатить). */
  missing: string[];
}

// ═══ Профили ════════════════════════════════════════════════════════════

/** Важность/кап = число ИЛИ per-slot ({Slot: n, default: n}). */
type ImpCap = number | Partial<Record<string, number>> & { default?: number };

interface ProfileStat {
  /** RU/EN-паттерн мода (значение — группа 1). */
  re: RegExp;
  label: string;
  /** Ключ для «same stat — один ролл» (суммарное качество ≤ 1.15). */
  id: string;
  imp: ImpCap;
  cap: ImpCap;
  res?: 'fire' | 'cold' | 'lightning' | 'chaos';
}

const pick = (v: ImpCap, slot: string): number =>
  typeof v === 'object' && v != null
    ? ((v as Record<string, number>)[slot] ?? (v as Record<string, number>).default ?? 0)
    : (v as number) || 0;

/** Паттерны: EN и RU (клиент RU — №680+). `%`-моды в PoE2 с `+`-префиксом. */
/** Паттерны EN + RU в ОДНОМ regex (RU-клиент — №680+). Значение — первое число строки. */
const P = {
  life: /\+ ?\d+ (?:to maximum Life|к максимуму (?:жизни|здоровья))/i,
  esFlat: /\+ ?\d+ (?:to maximum Energy Shield|к максимуму энергетического щита)/i,
  armour: /\+\d+ (?:to Armour|к броне)/i,
  evasion: /\+\d+ (?:to (?:the )?Evasion(?: Rating)?|к (?:рейтингу )?уклонени(?:я|ю))/i,
  spirit: /\+\d+ (?:to Spirit|к духу)/i,
  fres: /(?:\+)?\d+% (?:to|increased) Fire Resistance|\d+% к сопротивлению огню/i,
  cres: /(?:\+)?\d+% (?:to|increased) Cold Resistance|\d+% к сопротивлению холоду/i,
  lres: /(?:\+)?\d+% (?:to|increased) Lightning Resistance|\d+% к сопротивлению молнии/i,
  chres: /(?:\+)?\d+% (?:to|increased) Chaos Resistance|\d+% к сопротивлению хаосу/i,
  ms: /\d+% (?:increased|повышение|увеличение) Movement Speed|\d+% (?:повышение|увеличение) скорости передвижения/i,
  str: /\+\d+ (?:to Strength|к силе)/i,
  dex: /\+\d+ (?:to Dexterity|к ловкости)/i,
  int: /\+\d+ (?:to Intelligence|к интеллекту)/i,
  attr: /\+\d+ (?:to all Attributes|ко всем атрибутам|ко всем характеристикам)/i,
  // №696 P2-8: RU-канон mods_ru.json — «#% повышение редкости найденных
  // предметов» и «#% увеличение редкости находимых (на карте) предметов»;
  // раньше RU-текст уезжал в wasted (RU-ветки не было).
  rarity: /\d+% (?:increased Rarity of Items found|(?:повышение|увеличение) редкости (?:найденных|находимых)(?: на карте)? предметов)/i,
  atkSpeed: /\d+% (?:increased|повышение) Attack Speed|\d+% повышение скорости атаки/i,
  castSpeed: /\d+% (?:increased|повышение) Cast Speed|\d+% повышение скорости (?:сотворения|применения)? ?чар/i,
} as const;

/** Life & resistances (universal). */
const LIFE_RES_STATS: ProfileStat[] = [
  { re: P.life, label: 'Life', id: 'life', imp: { Weapon: 0, Jewel: 0, default: 7 }, cap: 100 },
  // Jewelry-flat обороны (живой факт: evasion на ring роллится — 10000 листингов
  // trade2; flat Armour на jewelry — 0 листингов, НЕ добавляем).
  { re: P.esFlat, label: 'Energy Shield', id: 'es', imp: { Amulet: 2, Ring: 2, Belt: 2, default: 0 }, cap: 60 },
  { re: P.evasion, label: 'Evasion', id: 'evflat', imp: { Ring: 3, Amulet: 3, Belt: 3, default: 0 }, cap: 120 },
  { re: P.fres, label: 'Fire res', id: 'fres', res: 'fire', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { re: P.cres, label: 'Cold res', id: 'cres', res: 'cold', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { re: P.lres, label: 'Lightning res', id: 'lres', res: 'lightning', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { re: P.chres, label: 'Chaos res', id: 'chres', res: 'chaos', imp: { Weapon: 0, Jewel: 0, default: 3 }, cap: 30 },
  { re: P.ms, label: 'Movement speed', id: 'ms', imp: { Boots: 10, default: 0 }, cap: 35 },
  { re: P.attr, label: 'Attributes', id: 'attrs', imp: { Jewel: 0, default: 2 }, cap: 35 },
  { re: P.str, label: 'Str/Dex/Int', id: 'attrs', imp: { Jewel: 0, default: 1.5 }, cap: 35 },
  { re: P.dex, label: 'Str/Dex/Int', id: 'attrs', imp: { Jewel: 0, default: 1.5 }, cap: 35 },
  { re: P.int, label: 'Str/Dex/Int', id: 'attrs', imp: { Jewel: 0, default: 1.5 }, cap: 35 },
  { re: P.spirit, label: 'Spirit', id: 'spirit', imp: { 'Body Armour': 5, Amulet: 5, default: 0 }, cap: 60 },
  { re: P.rarity, label: 'Rarity', id: 'rarity', imp: { Ring: 1.5, Amulet: 1.5, Helmet: 1.5, Gloves: 1.5, Boots: 1.5, default: 0 }, cap: 30 },
  { re: P.atkSpeed, label: 'Speed', id: 'speed', imp: { Weapon: 4, Ring: 3, Amulet: 3, Gloves: 3, default: 0 }, cap: 20 },
  { re: P.castSpeed, label: 'Speed', id: 'speed', imp: { Weapon: 4, Ring: 3, Amulet: 3, Gloves: 3, default: 0 }, cap: 20 },
];

const PROFILES: Record<GearscoreProfileId, { stats: ProfileStat[]; name: string; summary: string }> = {
  'life-res': {
    name: 'Life & resistances (ниверсал)',
    summary: 'Без билда: жизнь, резисты, базовая броня/уклонение/ES, скорость, DPS оружия.',
    stats: LIFE_RES_STATS,
  },
  'es-caster': {
    name: 'Energy Shield spellcaster (generic)',
    summary: 'ES-кастер: щит вместо жизни, скорость каста, Spirit, резисты.',
    stats: [
      { re: P.esFlat, label: 'Energy Shield', id: 'es', imp: { Amulet: 6, Ring: 5, Belt: 4, 'Body Armour': 7, Helmet: 6, Gloves: 5, Boots: 5, default: 0 }, cap: 60 },
      { re: P.castSpeed, label: 'Cast speed', id: 'cast', imp: { Weapon: 7, Ring: 5, Amulet: 5, default: 0 }, cap: 25 },
      // №695-ревью P1-1: НЕ тянуть из LIFE_RES_STATS дубли по id ('es', 'spirit') —
      // они заданы выше с бóльшими весами; дубль матчится первым и сильный вес
      // становится недостижимым + двоит знаменатель ideal.
      ...LIFE_RES_STATS
        .filter((s) => s.id !== 'es' && s.id !== 'spirit')
        .map((s) =>
          s.id === 'life' ? { ...s, imp: { Ring: 1.5, Amulet: 1.5, Belt: 1.5, 'Body Armour': 0, default: 1.5 } as ImpCap } : s,
        ),
      { re: P.spirit, label: 'Spirit', id: 'spirit', imp: { 'Body Armour': 8, Amulet: 6, Weapon: 5, default: 0 }, cap: 60 },
    ],
  },
};

// ═══ Слоты и базовые значения ════════════════════════════════════════════

/** itemClass (EN-клиент) → канонический слот профилей. */
function slotOfItem(item: ParsedItem): string {
  const cls = item.itemClass.toLowerCase();
  if (/helm/.test(cls)) return 'Helmet';
  if (/body armour|chest/.test(cls)) return 'Body Armour';
  if (/glove/.test(cls)) return 'Gloves';
  if (/boot/.test(cls)) return 'Boots';
  if (/ring/.test(cls)) return 'Ring';
  if (/amulet/.test(cls)) return 'Amulet';
  if (/belt/.test(cls)) return 'Belt';
  if (/shield|quiver/.test(cls)) return 'Offhand';
  if (/jewel/.test(cls)) return 'Jewel';
  if (/flask/.test(cls)) return 'Flask';
  if (/charm/.test(cls)) return 'Charm';
  if (/sword|axe|mace|staff|bow|crossbow|wand|sceptre|dagger|claw|spear/.test(cls)) return 'Weapon';
  return cls.replace(/s$/, '').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown';
}

const ARMOUR_SLOTS = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Offhand'];

/** Условные моды: «if you've…», «while», «недавно», «за заряд». */
const COND = /\b(if you|if you've|while|when|recently|per (?!second)|если вы|пока|недавно|за (?:заряд|воинский|сакральный))/i;

/** Локальные % моды обороны — уже сидят в [Base] числах парсера. */
const LOCAL_DEFENCE = /% (?:increased|повышение|увеличение) (?:Armour|Evasion|Energy Shield|брон|уклон|энергетическ)/i;
/** Flat +N к обороне на армор-слотах — тоже local (в珠宝 flat = глобальный, считается). */
const LOCAL_FLAT_DEF =
  /\+\d+ (?:to maximum Energy Shield|to Armour|to Evasion(?: Rating)?|к максимуму энергетического щита|к броне|к (?:рейтингу )?уклонени(?:я|ю))/i;

/** DPS оружия из offense парсера: avg физ + элем × ASPS. */
function weaponDps(item: ParsedItem): number | null {
  const o = item.offense;
  const aps = o.attacksPerSecond?.value;
  if (!aps || aps <= 0) return null;
  let dps = 0;
  if (o.physicalDamage) dps += ((o.physicalDamage.min + o.physicalDamage.max) / 2) * aps;
  for (const el of o.elementalDamage) dps += ((el.min + el.max) / 2) * aps;
  return dps > 0 ? dps : null;
}

const grade = (score: number): string =>
  score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'D';

const unrated = (slot: string, profile: GearscoreProfileId, reason: GearscoreResult['unratedReason']): GearscoreResult => ({
  rated: false,
  unratedReason: reason,
  slot,
  profile,
  profileName: PROFILES[profile]!.name,
  score: null,
  grade: '—',
  contributions: [],
  penalties: [],
  wasted: [],
  missing: [],
});

export interface GearScoreOptions {
  profile?: GearscoreProfileId;
  /** Сколько каждого резиста ещё нужно до капа (уже закрытый почти не весит). */
  resNeed?: Partial<Record<'fire' | 'cold' | 'lightning' | 'chaos', number>>;
  /** W5-C (№696) boost_from_gear: id профильных статов, важность ×1.5 —
   * приоритеты из вашего гира (suggestGearFocus → kind→id маппинг в MCP-туле). */
  boostIds?: string[];
}

// ═══ Ядро ═══════════════════════════════════════════════════════════════

export function gearScoreItem(itemText: string, opts: GearScoreOptions = {}): GearscoreResult {
  const profileId: GearscoreProfileId = opts.profile ?? 'life-res';
  const profile = PROFILES[profileId]!;
  let item: ParsedItem;
  try {
    item = parseItemText(itemText);
  } catch {
    return unrated('Unknown', profileId, 'not-item');
  }
  // Парсер НЕ бросает на мусоре (даёт Unknown/пустую базу) — не-предмет
  // узнаём по отсутствию базового типа. RU-клиенты базу парсят (№680).
  if (!item.baseType) return unrated(slotOfItem(item), profileId, 'not-item');
  const slot = slotOfItem(item);
  if (slot === 'Flask' || slot === 'Charm') return unrated(slot, profileId, slot === 'Flask' ? 'flask' : 'charm');
  if (item.unidentified) return unrated(slot, profileId, 'unidentified');
  if (/unique/i.test(item.rarity)) return unrated(slot, profileId, 'unique');

  const need = opts.resNeed ?? null;
  const K = slot === 'Jewel' ? 4 : ARMOUR_SLOTS.includes(slot) || slot === 'Weapon' ? 7 : 6;
  // W5-C (№696) boost_from_gear: импортантность профильных статов, которые
  // ваш гир уже стекает (выборка autoWeights), ×1.5 — везде единообразно
  // (contributions, usable, ideal, missing), поэтому score честно сравним.
  const boostIds = new Set(opts.boostIds ?? []);
  const impOf = (s: ProfileStat) => pick(s.imp, slot) * (boostIds.has(s.id) ? 1.5 : 1);
  const capOf = (s: ProfileStat) => pick(s.cap, slot) || 1;

  // «Идеальный предмет слота»: top-K статов профиля (неигнорируемых,
  // не-закрытых резистов) на полном ролле.
  const usable = profile.stats.filter((s) => {
    if (impOf(s) <= 0) return false;
    if (s.res && need && need[s.res] != null && need[s.res]! < capOf(s) * 0.25) return false;
    return true;
  });
  const ideal = Math.max(
    1,
    usable.map(impOf).sort((a, b) => b - a).slice(0, K).reduce((a, b) => a + b, 0),
  );

  const hasBaseDef = !!(item.defences.armour || item.defences.evasion || item.defences.energyShield);
  const dps = weaponDps(item);

  const contributions: GearscoreContribution[] = [];
  const penalties: GearscoreContribution[] = [];
  const wasted: string[] = [];
  const usedQ = new Map<string, number>(); // id → накопленное качество (≤1.15)
  const usedIds = new Set<string>();
  let dpsScored = false;

  // [Base] оборона и DPS — сами по себе «статы» ( качества = value/cap ).
  const baseEntries: Array<{ label: string; id: string; value: number; cap: number; imp: number }> = [];
  if (slot === 'Weapon' && dps) baseEntries.push({ label: 'Weapon DPS', id: 'dps', value: dps, cap: 250, imp: 10 });
  if (hasBaseDef && !/jewel|ring|amulet|belt/i.test(item.itemClass)) {
    if (item.defences.armour?.value) baseEntries.push({ label: 'Armour', id: 'arbase', value: item.defences.armour.value, cap: slot === 'Body Armour' ? 800 : 400, imp: profileId === 'life-res' ? (slot === 'Body Armour' ? 10 : slot === 'Offhand' ? 7 : 8) : 2 });
    if (item.defences.evasion?.value) baseEntries.push({ label: 'Evasion', id: 'evbase', value: item.defences.evasion.value, cap: slot === 'Body Armour' ? 800 : 400, imp: profileId === 'life-res' ? (slot === 'Body Armour' ? 9 : slot === 'Offhand' ? 7 : 8) : 2 });
    if (item.defences.energyShield?.value) baseEntries.push({ label: 'Energy Shield', id: 'esbase', value: item.defences.energyShield.value, cap: slot === 'Body Armour' ? (profileId === 'es-caster' ? 1000 : 500) : 400, imp: profileId === 'es-caster' ? (slot === 'Body Armour' ? 10 : slot === 'Offhand' ? 7 : 8) : 3 });
  }
  for (const b of baseEntries) {
    if (b.imp <= 0) continue;
    const quality = Math.max(0, Math.min(b.value / b.cap, 1.15));
    if (quality <= 0) continue;
    usedQ.set(b.id, quality);
    usedIds.add(b.id);
    contributions.push({
      key: `[Base] ${b.label}`,
      label: b.label,
      value: b.value,
      qualityPct: Math.round(quality * 100),
      points: Math.round(b.imp * quality * 10) / 10,
      source: 'implicit',
    });
    if (b.id === 'dps') dpsScored = true;
  }

  // Моды: явные/implicit/руны. Local Defence поверх [Base] — skip.
  // Отдельные «статы» профиля ищутся первым совпавшим паттерном.
  for (const mod of item.mods) {
    const text = mod.text.trim();
    if (LOCAL_DEFENCE.test(text)) continue;
    // Flat +N к обороне на армор-слотах — local: сидит в defences парсера.
    if (hasBaseDef && ARMOUR_SLOTS.includes(slot) && LOCAL_FLAT_DEF.test(text)) continue;
    // DPS уже посчитан из offense — локальные weapon-моды не дублируются.
    if (dpsScored && slot === 'Weapon' && /% (?:increased|повышение) (?:Attack Speed|физическ|Physical Damage)|Adds \d+/i.test(text)) continue;

    // Значение: первый профильный паттерн, КОТОРЫЙ матчится.
    let matchedStat: ProfileStat | null = null;
    let value: number | null = null;
    for (const s of profile.stats) {
      if (!s.re.test(text)) continue;
      const vm = text.match(/(-?\d+(?:\.\d+)?)/);
      if (!vm) continue;
      matchedStat = s;
      value = Number(vm[1]);
      break;
    }
    if (!matchedStat) {
      if ((mod.type === 'explicit' || mod.type === 'implicit') && /\d/.test(text)) wasted.push(text);
      continue;
    }
    if (value == null || !Number.isFinite(value) || value === 0) continue;
    const s = matchedStat;
    const imp = impOf(s);
    // №696 P2-7: imp 0 = профиль не ждёт этот стат на слоте — НЕ пушить в
    // contributions (0-очки = шум-строки в ответе и false «used» в missing).
    if (imp <= 0) continue;
    const cap = capOf(s);

    // Уже закрытый резист: вес обрезан до остатка.
    let v = value;
    if (s.res && need && need[s.res] != null) {
      v = Math.min(v, Math.max(0, need[s.res]!));
      if (v <= 0) continue;
    }
    if (value < 0) {
      // Минус-мод профилируемого стата — штраф.
      const points = imp * Math.max(-1, value / cap) * (COND.test(text) ? 0.6 : 1);
      penalties.push({
        key: text, label: s.label, value, qualityPct: 0,
        points: Math.round(points * 10) / 10, source: mod.type,
      });
      continue;
    }
    // «один старт — не больше одного топ-ролла» (implicit+explicit life).
    const sofar = usedQ.get(s.id) ?? 0;
    const quality = Math.max(0, Math.min(v / cap, 1.15 - sofar));
    if (quality <= 0) continue;
    usedQ.set(s.id, sofar + quality);
    usedIds.add(s.id);
    const factor = (mod.type === 'rune' || mod.type === 'enchant' ? 0.5 : 1) * (COND.test(text) ? 0.6 : 1);
    contributions.push({
      key: text, label: s.label, value: v,
      qualityPct: Math.round(quality * 100),
      points: Math.round(imp * quality * factor * 10) / 10,
      source: mod.type,
    });
  }

  contributions.sort((a, b) => b.points - a.points);
  const total =
    contributions.reduce((a, c) => a + c.points, 0) + penalties.reduce((a, c) => a + c.points, 0);
  const score = Math.max(0, Math.min(100, Math.round((100 * total) / ideal)));
  const missing = usable
    .filter((s) => !usedIds.has(s.id) && impOf(s) >= 5)
    .sort((a, b) => impOf(b) - impOf(a))
    .slice(0, 3)
    .map((s) => s.label);

  return {
    rated: true,
    slot,
    profile: profileId,
    profileName: profile.name,
    score,
    grade: grade(score),
    contributions,
    penalties,
    wasted,
    missing,
  };
}
