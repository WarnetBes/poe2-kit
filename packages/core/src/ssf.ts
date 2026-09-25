/**
 * SSF-режим прайс-тулов: вместо цены предмета — что делать в Solo Self-Found.
 *
 * Без сети, только по разобранному клир-тексту (ParsedItem) + зонам прокачки.
 * Это ЧЕСТНЫЙ ЭВРИСТИЧЕСКИЙ план (поле `heuristic`), а не игровые данные:
 *  - форм-фактор предмета (слот, база, требования, ilvl);
 *  - какие фрактуред-моды сохранять (не обязательные можно перекрафтить);
 *  - план крафта под класс базы;
 *  - самая близкая зона кампании под ilvl/уровень (где естественно фармить базу).
 *
 * Принцип: не выдумываем цифры дропа — даём проверяемые факты из разбора
 * и явно помечаем рекомендации как эвристику (по аналогии с ADVICE_DEFAULTS
 * в advice.ts).
 */

import { LEVELING_ZONES } from './leveling.js';
import { parseItemText, itemDisplayName } from './parse.js';
import type { ParsedItem, ItemMod } from './parse.js';

/** Оценка фрактуред-мода: сохранить при крафте или можно перебросить. */
export interface SsfFracturedMod {
  /** Текст мода как в игре. */
  text: string;
  /** true — важный мод, стоит закладывать крафт вокруг него. */
  keep: boolean;
  /** Почему так классифицирован (кратко). */
  reason: string;
}

/** Шаг плана крафта. */
export interface SsfCraftingStep {
  /** Заголовок шага (глагол). */
  step: string;
  /** Подробность/пример. */
  detail: string;
}

/** Полная оценка предмета в SSF-контексте. */
export interface SsfAssessment {
  /** true — рекомендации эвристические, а не данные игры. */
  heuristic: boolean;
  /** Отображаемое имя предмета. */
  displayName: string;
  /** Базовый тип. */
  baseType: string;
  /** Item Class, например "Body Armours". */
  itemClass: string;
  /** Редкость. */
  rarity: string;
  /** Требуемый уровень (если есть). */
  requirementLevel: number | null;
  /** Item Level (если есть). */
  itemLevel: number | null;
  /** Самая близкая зона кампании под ilvl/уровень предмета (или null). */
  dropZone: string | null;
  /** Фрактуред-моды и их классификация. */
  fractured: SsfFracturedMod[];
  /** План крафта под класс базы. */
  crafting: SsfCraftingStep[];
  /** Примечание по добыче/получению в зависимости от редкости. */
  dropNote: string;
}

// ─── Классификация фрактуред-модов ────────────────────────────────────────

/** Ключевые фразы «важных» модов — их стоит сохранять при крафте. */
const KEEP_KEYWORDS: Array<{ re: RegExp; reason: string }> = [
  { re: /resistanc/i, reason: 'резист — всегда полезен в SSF' },
  { re: /elemental resistance/i, reason: 'резист стихий' },
  { re: /maximum (life|energy shield|mana)/i, reason: 'пул ресурса — база выживаемости' },
  { re: /\b(life|health)\b/i, reason: 'жизнь' },
  { re: /energy shield/i, reason: 'энергосщит (пул) для ES-билдов' },
  { re: /\barmour\b/i, reason: 'броня — слой защиты' },
  { re: /\bevasion\b/i, reason: 'уклонение — слой защиты' },
  { re: /block chance/i, reason: 'шанс блока — слой защиты' },
  { re: /physical damage/i, reason: 'физ-урон — ключ для оружия' },
  { re: /adds .* physical damage/i, reason: 'физ-урон флэтом — ключ для оружия' },
  { re: /critical/i, reason: 'крит — ключ для критовых билдов' },
  { re: /attack speed/i, reason: 'скорость атак' },
  { re: /elemental damage/i, reason: 'элементальный урон' },
  { re: /charge/i, reason: 'заряды — ресурс билда' },
  { re: /to all attribute/i, reason: 'все характеристики' },
];

function classifyFractured(text: string): SsfFracturedMod {
  const t = text.toLowerCase();
  for (const k of KEEP_KEYWORDS) {
    if (k.re.test(t)) return { text, keep: true, reason: k.reason };
  }
  return {
    text,
    keep: false,
    reason: 'не критично для прогресса — можно перебросить/убрать при крафте',
  };
}

// ─── План крафта по классу базы ───────────────────────────────────────────

const WEAPON_CLASSES = /quarterstaff|staff|sceptre|bow|crossbow|wand|mace|sword|axe|claw|dagger|spear|flail/i;
const ARMOUR_CLASSES = /body armour|helmet|boots|gloves|shield|quiver/i;
const ACC_CLASSES = /ring|amulet|belt|focus/i;
const GEM_CLASSES = /gem|stackable currency/i;
const FLASK_CLASSES = /flask/i;

function craftingFor(itemClass: string, isGear: boolean): SsfCraftingStep[] {
  if (GEM_CLASSES.test(itemClass)) {
    return [
      {
        step: 'Гем растёт уровнем',
        detail:
          'SSF-гемы прокачиваются добычей/свопом из Uncut. На прокачку билда нужны Uncut Skill/Support Gem нужного уровня — фармить их надёжнее в картах под свой уровень.',
      },
    ];
  }
  if (WEAPON_CLASSES.test(itemClass)) {
    return [
      {
        step: 'Выбрать белую базу подходящего ilvl',
        detail:
          'Лучший базовый тир оружия под ilvl предмета. В SSF добывается дропом/вендором; на высокий ilvl — карты уровня ≥ предмета.',
      },
      {
        step: 'Задать физ-базу и крит',
        detail:
          'Фокус на физический урон (база плюсится орбами к физ-урону) и крит/атак-спид. Фрактуред-мод сохраняется — строй план вокруг него.',
      },
      {
        step: 'Докрафтить недостающее',
        detail:
          'После бейс/крит добавь урон или полезный аффикс через крафт-станок/орбы. Не обязательные моды можно перебросить.',
      },
    ];
  }
  if (ARMOUR_CLASSES.test(itemClass)) {
    return [
      {
        step: 'Выбрать базу с нужной защитой',
        detail: `Слот ${itemClass}: база с приоритетной защитой (armour/evasion/energy shield) под задумку билда.`,
      },
      {
        step: 'Накинуть основную защиту',
        detail: 'Увеличь основную защиту слота (орбы к броне/уклонению/ES).',
      },
      {
        step: 'Докрафтить резист/мод',
        detail: 'Разбей недобор элементов (резист/жизнь/ES) мастеркрафтом; фрактуред-мод сохраняй если важен.',
      },
    ];
  }
  if (ACC_CLASSES.test(itemClass)) {
    return [
      {
        step: 'Закрыть резисты и пул',
        detail: `Слот ${itemClass}: приоритет — недостающие резисты, жизнь / энергосщит / урон под билд.`,
      },
      {
        step: 'Докрафтить под стиль',
        detail: 'Собери нужные аффиксы крафт-станком/орбами. Фрактуред-мод с резистом/жизнью — придержи.',
      },
    ];
  }
  if (FLASK_CLASSES.test(itemClass)) {
    return [
      {
        step: 'Собрать фласку под билд',
        detail: 'Фласки в SSF копятся дропом. Ищи нужные базы/модификаторы, не тратя валюту на крафт фласк.',
      },
    ];
  }
  return [
    {
      step: 'Определить слот',
      detail: `Класс "${itemClass}" — уточни роль предмета (защита/урон/поддержка) перед крафтом.`,
    },
    {
      step: 'Закрыть слабое место',
      detail: 'Приоритет — закрыть недобор (резист/пул/урон) из текущих проблем билда.',
    },
  ];
}

function dropNoteFor(rarity: string, itemClass: string): string {
  if (rarity === 'Unique') {
    return 'Уникальный предмет не крафтится из базы — добывается дропом (часто у конкретного босса). В SSF фармится точечно, а не покупается; запасные варианты на тот же слот важны.';
  }
  if (GEM_CLASSES.test(itemClass)) {
    return 'Гемы — Uncut Skill/Support: прокачиваются и открывают уровни по мере добычи. В SSF их не купишь — фасись Uncut нужного уровня.';
  }
  if (rarity === 'Currency') {
    return 'Валюта в SSF — расходник: не тратится на покупку, а вкладывается в крафт. Приоритет — орбы для ключевых аффиксов.';
  }
  return 'Магические/редкие основы в SSF берутся дропом, от вендора или крафтом из белой базы надлежащего ilvl. «Купить» замену нельзя — закладывай крафт.';
}

/** Найти самую близкую зону кампании (по легендарному уровню) под target. */
function findDropZone(target: number | null): string | null {
  if (target == null) return null;
  let best: { zone: string; diff: number } | null = null;
  for (const z of LEVELING_ZONES) {
    const diff = target - z.monsterLevel;
    if (best == null || Math.abs(diff) < Math.abs(best.diff)) {
      best = { zone: `Акт ${z.act}: ${z.zone} (моб ~L${z.monsterLevel})`, diff };
    }
  }
  return best?.zone ?? null;
}

// ─── Главные функции ──────────────────────────────────────────────────────

/** SSF-оценка по уже разобранному предмету. */
export function ssfAssessment(parsed: ParsedItem): SsfAssessment {
  const fracturedMods = parsed.mods.filter((m) => m.type === 'fractured');
  const ilvl = parsed.itemLevel;
  const reqLvl = parsed.requirements?.level ?? null;
  const target = ilvl ?? reqLvl;

  const fractured = fracturedMods.map((m) => classifyFractured(m.text));

  // Категорию берём из itemClass ИЛИ baseType — в реальном клир-тексте строки
  // "Item Class:" может не быть, но baseType сам несёт категорию ("Expert Claw").
  const catSubject = [parsed.itemClass, parsed.baseType].filter(Boolean).join(' ');
  let crafting = craftingFor(catSubject, true);
  if (fractured.length) {
    const kept = fractured.some((f) => f.keep);
    if (kept) {
      crafting = [
        {
          step: 'Заложить фрактуред-мод',
          detail:
            'Фрактуред-мод сохраняется при крафте. Если он важен — строй остальные аффиксы вокруг него и не перебрось его случайно.',
        },
        ...crafting,
      ];
    }
  }

  return {
    heuristic: true,
    displayName: itemDisplayName(parsed) || parsed.baseType || parsed.name || parsed.itemClass,
    baseType: parsed.baseType,
    itemClass: parsed.itemClass,
    rarity: parsed.rarity,
    requirementLevel: reqLvl,
    itemLevel: ilvl,
    dropZone: target != null ? findDropZone(target) : null,
    fractured,
    crafting,
    dropNote: dropNoteFor(parsed.rarity, catSubject),
  };
}

/** SSF-оценка по клир-тексту предмета. */
export function ssfAssessmentFromText(itemText: string): SsfAssessment {
  return ssfAssessment(parseItemText(itemText));
}

// ─── Форматировщики для MCP ──────────────────────────────────────────────

/** Человекочитаемый текст SSF-оценки для одного предмета. */
export function formatSsf(a: SsfAssessment): string {
  const lines: string[] = [`### ${a.displayName}`];

  if (a.heuristic) lines.push('> Эвристические рекомендации для SSF (не игровые данные).');

  lines.push(
    `- **База:** ${a.baseType || '—'} · **Слот:** ${a.itemClass || '—'} · **Редкость:** ${a.rarity || '—'}`,
  );
  if (a.itemLevel != null) lines.push(`- **Item Level:** ${a.itemLevel}`);
  if (a.requirementLevel != null) lines.push(`- **Требуемый уровень:** ${a.requirementLevel}`);
  if (a.dropZone) lines.push(`- **Ближайшая зона дропа/крафта базы:** ${a.dropZone}`);

  lines.push('', `**Фрактуред-моды:**`);
  if (a.fractured.length) {
    for (const f of a.fractured) {
      lines.push(`- ${f.keep ? '✅ сохранить' : '⚠️ опционально'} — ${f.text} (${f.reason})`);
    }
  } else {
    lines.push('- нет');
  }

  lines.push('', '**План крафта (SSF):**');
  a.crafting.forEach((c, i) => lines.push(`${i + 1}. **${c.step}** — ${c.detail}`));

  lines.push('', `**Добыча:** ${a.dropNote}`);
  return lines.join('\n');
}

/** Отчёт по снаряжению билда целиком (slot → SSF-оценка). */
export function ssfBuildReport(
  gear: Record<string, string>,
): Array<{ slot: string; assessment: SsfAssessment }> {
  const out: Array<{ slot: string; assessment: SsfAssessment }> = [];
  for (const [slot, text] of Object.entries(gear)) {
    if (!text || !text.trim()) continue;
    const trimmed = text.trim();
    const parsed = parseItemText(trimmed);
    // PoB-экспорт по уникам часто несёт только имя без полного клир-текста
    // (нет строки "Rarity:", базы/модов). Тогда базовый разбор пуст — честно
    // сводим к «уникальный предмет: добыча дропом, не крафтится».
    if ((!parsed.baseType && parsed.rarity === 'Unknown') || parsed.rarity === 'Unique') {
      const nameOnly = trimmed.split(/\r?\n/)[0] ?? trimmed;
      out.push({
        slot,
        assessment: {
          heuristic: true,
          displayName: nameOnly,
          baseType: parsed.baseType,
          itemClass: parsed.itemClass,
          rarity: 'Unique',
          requirementLevel: null,
          itemLevel: parsed.itemLevel,
          dropZone: null,
          fractured: [],
          crafting: [
            {
              step: 'Уникальный предмет — не крафтится',
              detail: 'В SSF уник добывается дропом (часто у конкретного босса/активности). Готовь запасную базу на слот — редкие уники не гарантированы.',
            },
          ],
          dropNote: 'Уникальный предмет: добыча фармом, не крафт из базы.',
        },
      });
      continue;
    }
    out.push({ slot, assessment: ssfAssessmentFromText(trimmed) });
  }
  return out;
}