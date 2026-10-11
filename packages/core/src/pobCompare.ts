/**
 * PoB-сравнение билдов (E2, мастер-план §6): diff «текущий vs эталон».
 * Донор-структура: comparePobBuilds (poe2-mcp-server, MIT © 2026 Serghei Iakovlev,
 * src/services/pob.ts:916-1035) — паттерн items/tree/skills-diff; реализация на
 * наших типах BuildImport и сильнее донора:
 *  - пассивки ПОИМЁННО (donor: «Requires tree data», только числа) — у нас
 *    есть numeric_ids.json + tree.json (dataset getPassiveNodeById);
 *  - ВСЕ diff-саппорты на скилл, не один (у донора break после первого);
 *  - gem-уровни сравниваются (у донора их нет вовсе);
 *  - защита из parseItemText (ES/Armour/Evasion-дельты по слотам).
 */

import type { BuildImport } from './types.js';
import { parseItemText, type ParsedItem } from './parse.js';
import { getPassiveNodeById } from './dataset.js';
import { isSupportGemName } from './buildPlanner.js';

// ── Типы результата ─────────────────────────────────────────────────────────

export interface PobCompareItemSlot {
  slot: string;
  currentName: string | null;
  currentBase: string | null;
  referenceName: string | null;
  referenceBase: string | null;
  /** Дельты защиты в формате "+123 ES / -50 Armour" (пусто — если чисел нет). */
  delta: string[];
}

export interface PobCompareSkillGroup {
  /** Активный гем группы (эталонное имя). */
  skill: string;
  /** Саппорты, которых нет в текущем (есть в эталоне). */
  missingSupports: string[];
  /** Саппорты, которых нет в эталоне (есть в текущем). */
  extraSupports: string[];
  /** Уровень гема в текущем / в эталоне (null — группа отсутствует). */
  currentLevel: number | null;
  referenceLevel: number | null;
}

export interface PobCompareNode {
  id: string;
  name: string | null;
  isKeystone: boolean;
  isNotable: boolean;
}

export interface PobCompareResult {
  /** Сводка в одну строку (RU). */
  summary: string;
  meta: {
    currentClass: string | null;
    currentAscendancy: string | null;
    currentLevel: number | null;
    referenceClass: string | null;
    referenceAscendancy: string | null;
    referenceLevel: number | null;
  };
  items: {
    /** Слоты эталона, пустые в текущем. */
    slotsMissing: string[];
    /** Слоты с одинаковым предметом (имя+база+редкость). */
    matching: string[];
    /** Слоты с другим предметом + дельты защиты. */
    changed: PobCompareItemSlot[];
  };
  passives: {
    /** Узлы эталона, не взятые в текущем (поимённо). */
    missing: PobCompareNode[];
    /** Узлы текущего, которых нет в эталоне. */
    extra: PobCompareNode[];
    matchingCount: number;
    currentCount: number;
    referenceCount: number;
  };
  skills: {
    /** Активные гемы эталона, которых нет в текущем. */
    missingGems: string[];
    /** Активные гемы текущего, которых нет в эталоне. */
    extraGems: string[];
    /** Per-skill: саппорты и уровни (только для общих активных). */
    groups: PobCompareSkillGroup[];
  };
  config: {
    /** Ключи конфигурации с разными значениями (без сравнения, если у сторон разный набор). */
    differing: Array<{ key: string; current: string; reference: string }>;
  };
}

// ── Вспомогательные ─────────────────────────────────────────────────────────

function parsedOrNull(itemText: string | undefined): ParsedItem | null {
  if (!itemText || !itemText.trim()) return null;
  try {
    return parseItemText(itemText);
  } catch {
    return null;
  }
}

function nameOf(item: string | undefined): string | null {
  return item ? item.trim() || null : null;
}

function idKey(n: string): string {
  return n.trim();
}

/** «None»/пусто у PoB — отсутствие асценданси: в meta показываем null. */
function normalizeAsc(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return !t || /^none$/i.test(t) ? null : t;
}

/** Строковый ключ гема — точный, но регистронезависимый для сопоставления. */
function gemKey(n: string): string {
  return n.trim().toLowerCase();
}

// ── Слой items/gear ─────────────────────────────────────────────────────────

function compareItems(
  cur: Record<string, string>,
  ref: Record<string, string>,
): PobCompareResult['items'] {
  const slotsMissing: string[] = [];
  const matching: string[] = [];
  const changed: PobCompareItemSlot[] = [];
  for (const [slot, refText] of Object.entries(ref)) {
    if (!refText || !refText.trim()) continue;
    const curText = cur[slot];
    if (!curText || !curText.trim()) {
      slotsMissing.push(slot);
      continue;
    }
    const cp = parsedOrNull(curText);
    const rp = parsedOrNull(refText);
    const same =
      cp &&
      rp &&
      cp.name === rp.name &&
      cp.baseType === rp.baseType &&
      cp.rarity === rp.rarity;
    if (same) {
      matching.push(slot);
      continue;
    }
    const delta: string[] = [];
    if (cp && rp) {
      const cell = (l: string, d: number): string | null => (d !== 0 ? `${d > 0 ? '+' : ''}${d} ${l}` : null);
      const cells = [cell('ES', (rp.defences.energyShield?.value ?? 0) - (cp.defences.energyShield?.value ?? 0)), cell('Armour', (rp.defences.armour?.value ?? 0) - (cp.defences.armour?.value ?? 0)), cell('Evasion', (rp.defences.evasion?.value ?? 0) - (cp.defences.evasion?.value ?? 0))];
      delta.push(...cells.filter((x): x is string => x !== null));
    }
    changed.push({
      slot,
      currentName: cp?.name ?? nameOf(curText) ?? null,
      currentBase: cp?.baseType ?? null,
      referenceName: rp?.name ?? nameOf(refText) ?? null,
      referenceBase: rp?.baseType ?? null,
      delta,
    });
  }
  return { slotsMissing, matching, changed };
}

// ── Слой passives (поимённо, E2 сильнее донора) ─────────────────────────────

function toNode(id: string): PobCompareNode {
  const n = getPassiveNodeById(id);
  return {
    id,
    name: n?.name ?? null,
    isKeystone: !!n?.isKeystone,
    isNotable: !!n?.isNotable,
  };
}

function comparePassives(cur: string[], ref: string[]): PobCompareResult['passives'] {
  const curSet = new Set(cur.map(idKey).filter(Boolean));
  const refSet = new Set(ref.map(idKey).filter(Boolean));
  const missingNodes = [...refSet].filter((n) => !curSet.has(n)).map(toNode);
  const extraNodes = [...curSet].filter((n) => !refSet.has(n)).map(toNode);
  return {
    missing: missingNodes,
    extra: extraNodes,
    matchingCount: [...refSet].filter((n) => curSet.has(n)).length,
    currentCount: curSet.size,
    referenceCount: refSet.size,
  };
}

// ── Слой skills (группы + уровни; без групп — плоский список) ────────────────

interface ActiveInfo {
  /** Отображаемое имя гема (канонический регистр из групп PoB). */
  name: string;
  level: number | null;
  supports: Map<string, string>; // key → display name
}

function activeMap(b: BuildImport): Map<string, ActiveInfo> {
  const out = new Map<string, ActiveInfo>();
  if (b.skillGroups?.length) {
    for (const g of b.skillGroups) {
      if (!g.enabled) continue;
      const actives = g.gems.filter((x) => x.name && !isSupportName(x.name));
      const supports = g.gems.filter((x) => x.name && isSupportName(x.name));
      for (const a of actives) {
        const key = gemKey(a.name);
        const prev = out.get(key);
        const sup = new Map<string, string>();
        for (const s of supports) sup.set(gemKey(s.name), s.name);
        if (!prev) {
          out.set(key, { name: a.name, level: a.level, supports: sup });
        } else {
          // Тот же активный в двух группах — держим максимальный уровень и объединённые саппорты.
          prev.level = prev.level != null && a.level != null ? Math.max(prev.level, a.level) : (prev.level ?? a.level);
          for (const [k, v] of sup) if (!prev.supports.has(k)) prev.supports.set(k, v);
        }
      }
    }
    return out;
  }
  for (const name of b.skills) {
    if (name && !out.has(gemKey(name))) out.set(gemKey(name), { name, level: null, supports: new Map() });
  }
  return out;
}

function isSupportName(name: string): boolean {
  return isSupportGemName(name);
}

function compareSkills(cur: BuildImport, ref: BuildImport): PobCompareResult['skills'] {
  const cm = activeMap(cur);
  const rm = activeMap(ref);
  const missingGems: string[] = [];
  const extraGems: string[] = [];
  const groups: PobCompareSkillGroup[] = [];
  for (const [key, info] of rm) {
    const curInfo = cm.get(key);
    if (!curInfo) {
      missingGems.push(info.name);
      continue;
    }
    const missingSupports: string[] = [];
    const extraSupports: string[] = [];
    // ВСЕ diff-саппорты на скилл — у донора break после первого (pob.ts:996).
    for (const [sk, sn] of info.supports) if (!curInfo.supports.has(sk)) missingSupports.push(sn);
    for (const [sk, sn] of curInfo.supports) if (!info.supports.has(sk)) extraSupports.push(sn);
    // Слой уровней: отличие фиксируем, только когда обе стороны известны.
    if (missingSupports.length || extraSupports.length || (info.level != null && curInfo.level != null && info.level !== curInfo.level)) {
      groups.push({
        skill: info.name,
        missingSupports,
        extraSupports,
        currentLevel: curInfo.level,
        referenceLevel: info.level,
      });
    }
  }
  for (const [key, info] of cm) if (!rm.has(key)) extraGems.push(info.name);
  return { missingGems, extraGems, groups };
}

// ── Слой config ──────────────────────────────────────────────────────────────

function compareConfig(
  cur: Record<string, string> | undefined,
  ref: Record<string, string> | undefined,
): PobCompareResult['config'] {
  if (!cur || !ref) return { differing: [] };
  const differing: Array<{ key: string; current: string; reference: string }> = [];
  for (const [k, rv] of Object.entries(ref)) {
    const cv = cur[k];
    if (cv !== undefined && cv !== rv) differing.push({ key: k, current: String(cv), reference: String(rv) });
  }
  return { differing };
}

// ─── Main ────────────────────────────────────────────────────────────────────

/** Сравнить текущий билд с эталонным (не сеть: объекты уже импортированы через importBuild). */
export function comparePobBuilds(current: BuildImport, reference: BuildImport): PobCompareResult {
  const items = compareItems(current.gear ?? {}, reference.gear ?? {});
  const passives = comparePassives(current.passiveNodes ?? [], reference.passiveNodes ?? []);
  const skills = compareSkills(current, reference);
  const meta = {
    currentClass: current.class ?? null,
    // PoB пишет "None" для билда без асценданси — показываем честный null.
    currentAscendancy: normalizeAsc(current.ascendancy),
    currentLevel: current.level ?? null,
    referenceClass: reference.class ?? null,
    referenceAscendancy: normalizeAsc(reference.ascendancy),
    referenceLevel: reference.level ?? null,
  };
  const config = compareConfig(current.config, reference.config);

  const parts: string[] = [];
  if (items.slotsMissing.length) parts.push(`пустых слотов: ${items.slotsMissing.length}`);
  if (items.changed.length) parts.push(`слотов с другим предметом: ${items.changed.length}`);
  if (passives.missing.length) parts.push(`узлов дерева не хватает: ${passives.missing.length}`);
  if (skills.missingGems.length) parts.push(`гемов не хватает: ${skills.missingGems.length}`);
  if (skills.groups.some((g) => g.missingSupports.length)) parts.push(`саппорт-гэпов: ${skills.groups.reduce((a, g) => a + g.missingSupports.length, 0)}`);
  const summary = parts.length ? parts.join(', ') : 'билды совпадают по сравнению слоёв (gear/пассивки/скиллы)';
  return { summary, meta, items, passives, skills, config };
}

// ── RU-вердикт (стиль summarizeBuild) ───────────────────────────────────────

const fmtNode = (n: PobCompareNode): string =>
  n.name ? `${n.name}${n.isKeystone ? ' (keystone)' : n.isNotable ? ' (notable)' : ''}` : `ID ${n.id}`;

/** Человекочитаемый RU-вердикт по результату comparePobBuilds. */
export function formatPobCompare(res: PobCompareResult): string {
  const out: string[] = ['## Сравнение с эталонным билдом', ''];
  const { meta, items, passives, skills } = res;

  out.push(
    `**Текущий:** ${meta.currentClass ?? '?'}${meta.currentAscendancy ? ` (${meta.currentAscendancy})` : ''}, ур. ${meta.currentLevel ?? '?'} · ` +
      `**Эталон:** ${meta.referenceClass ?? '?'}${meta.referenceAscendancy ? ` (${meta.referenceAscendancy})` : ''}, ур. ${meta.referenceLevel ?? '?'}`,
    '',
    `**Сводка:** ${res.summary}`,
  );

  // ── Предметы
  const secTitle = (t: string) => out.push('', `### ${t}`);
  if (items.slotsMissing.length) {
    secTitle(`Пустые слоты эталона (${items.slotsMissing.length})`);
    out.push(items.slotsMissing.join(', '));
  }
  if (items.changed.length) {
    secTitle(`Слоты с другим предметом (${items.changed.length})`);
    for (const c of items.changed) {
      const d = c.delta.length ? ` — ${c.delta.join(', ')}` : '';
      out.push(`- ${c.slot}: «${c.referenceName ?? c.referenceBase ?? '?'}» (эталон) — у вас «${c.currentName ?? c.currentBase ?? '?'}»${d}`);
    }
  }
  if (items.matching.length) {
    secTitle(`Совпадающие слоты (${items.matching.length})`);
    out.push(items.matching.join(', '));
  }

  // ── Пассивки: ЧТО не взято поимённо (наш козырь против донора — там только числа)
  if (passives.missing.length || passives.extra.length) {
    secTitle('Дерево пассивок');
    out.push(
      `В эталоне ${passives.referenceCount} узлов, у вас ${passives.currentCount}, совпадает ${passives.matchingCount}.`,
    );
    if (passives.missing.length) {
      const top = passives.missing.slice(0, 15).map(fmtNode);
      out.push(`**Не хватает (${passives.missing.length}):** ${top.join('; ')}${passives.missing.length > 15 ? ' …' : ''}`);
    }
    if (passives.extra.length) {
      const top = passives.extra.slice(0, 15).map(fmtNode);
      out.push(`**Лишние/иные (${passives.extra.length}):** ${top.join('; ')}${passives.extra.length > 15 ? ' …' : ''}`);
    }
  } else {
    secTitle('Дерево пассивок');
    out.push('Совпадает полностью.');
  }

  // ── Скиллы
  const skillParts: string[] = [];
  if (skills.missingGems.length) skillParts.push(`нет активных гемов: ${skills.missingGems.join(', ')}`);
  if (skills.extraGems.length) skillParts.push(`лишние активные: ${skills.extraGems.join(', ')}`);
  if (skills.missingGems.length || skills.extraGems.length || skills.groups.length) {
    secTitle('Скиллы');
  }
  if (skillParts.length) out.push(...skillParts.map((p) => `**${p}**`));
  for (const g of skills.groups) {
    const bits: string[] = [];
    if (g.missingSupports.length) bits.push(`ждёт саппорты: ${g.missingSupports.join(', ')}`);
    if (g.extraSupports.length) bits.push(`лишние саппорты: ${g.extraSupports.join(', ')}`);
    const lv =
      g.currentLevel != null && g.referenceLevel != null && g.currentLevel !== g.referenceLevel
        ? `уровень ${g.currentLevel} vs ${g.referenceLevel} в эталоне`
        : null;
    if (lv) bits.push(lv);
    out.push(`- **${g.skill}:** ${bits.length ? bits.join('; ') : 'саппорты совпадают, уровень отличается'}`);
  }

  // ── Конфиг (лаконично: только различия)
  if (res.config.differing.length) {
    secTitle('Конфигурация (различия)');
    for (const d of res.config.differing.slice(0, 10)) {
      out.push(`- ${d.key}: у вас «${d.current}», в эталоне «${d.reference}»`);
    }
  }

  return out.join('\n');
}
