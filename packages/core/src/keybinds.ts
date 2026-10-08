/**
 * Советчик раскладки навыков PoE2 (Keybind Advisor) — №221/SPEC_KEYBIND_ADVISOR.md.
 *
 * Чистая детерминированная функция без I/O: PoB-билд → рекомендованная
 * раскладка под платформу (Xbox / PlayStation / клавиатура) с обоснованием.
 *
 * Верифицированные факты об управлении (SPEC §1):
 *  - Геймпад PoE2: 22 бинд-слота = 11 кнопок + второй сет при удержании L2
 *    (модификатор переназначаемый). Источник: комментарий GGG (Negitivefrags,
 *    devtrackers.gg/p/506dde9f).
 *  - ~5 слотов системные (Dodge Roll, Any Life/Mana Flask, Overlay Map,
 *    Portal Scroll); эргономика GGG: primary → R1, dodge → L1, фляги → D-pad,
 *    редкое → L2+face.
 *  - Клавиатура: хотбар = LMB/RMB/MMB + Q W E R T; клик-мув и WASD.
 *  - Ауры/херальды PoE2 резервируют Spirit и Кастуются раз — боевой слот
 *    НЕ занимают (dataset.ts activeGemSource: 'reserve').
 *
 * Чего НЕ делаем: не читаем/не пишем конфиг игры (GGG не экспортирует бинды
 * файлом) — советник генерирует ИНСТРУКЦИЮ, а не применяет. Все эвристики,
 * не подтверждённые датасетом, помечаются `unverified` с причиной.
 */

import type { BuildImport, BuildSkillGroup } from './types.js';
import { getSkillGemDetails } from './dataset.js';

export type KeybindPlatform = 'xbox' | 'playstation' | 'keyboard';
export type KeybindMovementMode = 'wasd' | 'click';
export type KeybindRole = 'primary' | 'secondary' | 'burst' | 'movement' | 'buff' | 'curse' | 'aura' | 'unknown';

export interface KeybindSlot {
  /** Основная нотация: Xbox-кнопка или клавиша. */
  slot: string;
  /** Эквивалент в PS-нотации (только для геймпадов). */
  ps?: string;
  role: KeybindRole | 'system' | 'free';
  /** Имя камня (для role != system/free). */
  gem?: string;
  /** Системное назначение (Dodge Roll, Any Life Flask…). */
  system?: string;
  /** Обоснование одной строкой. */
  reason: string;
  /** Честная пометка эвристики, требующей живой сверки в игре. */
  unverified?: string;
}

export interface KeybindSpiritEntry {
  gem: string;
  /** Резервация Spirit из датасета (levels[0].cost.spirit), если есть. */
  spiritCost: number | null;
  note: string;
}

export interface KeybindAdvice {
  platform: KeybindPlatform;
  /** Слоты с назначенными навыками (в порядке рекомендованной важности). */
  assignments: KeybindSlot[];
  /** Системные слоты (dodge/фляги/карта/портал — не занимать). */
  system: KeybindSlot[];
  /** Свободные слоты (запас под рост билда). */
  free: KeybindSlot[];
  /** Ауры/херальды: НЕ биндить, резервация Spirit. */
  spirit: KeybindSpiritEntry[];
  /** Число бинд-слотов платформы, доступных навыкам (геймпад PoE2: 22 всего). */
  totalSlots: number;
  /** Пошаговая инструкция ручной установки в игре (только верифицированные пути меню). */
  manual: string[];
  /** Камни, которым не хватило слотов. */
  unassigned: string[];
  unverifiedNotes: string[];
}

export interface KeybindsOpts {
  platform?: KeybindPlatform;
  movement_mode?: KeybindMovementMode;
  /** Пин пользователя: имя камня → роль (перекрывает эвристики). */
  overrides?: Partial<Record<string, KeybindRole>>;
}

// ─── Роли ──────────────────────────────────────────────────────────────────

/**
 * Эвристика мув-скилла по имени (❓ сверить в игре — SPEC §3 movement).
 * ⚠ Только однозначные корни: 'charge' ловит Charged Staff, 'flicker' —
 * Flicker Strike (это не travel) — НЕ включать (доказано тестом эталона).
 */
const MOVEMENT_NAME_RE = /\b(flurry|leap|dash|blink|teleport)\b/i;

function classifyRole(
  name: string,
  isMain: boolean,
  overrides: Partial<Record<string, KeybindRole>>,
): { role: KeybindRole; unverified?: string } {
  const pinned = overrides[name];
  const det = getSkillGemDetails(name);
  const types = det?.skillTypes ?? [];

  if (pinned) return { role: pinned };
  // Data-driven (dataset skillTypes): HasReservation = persistent с резервацией
  // Spirit (херальды/дансы/Cast on Critical в PoE2) — боевой слот НЕ занимают.
  if (
    types.includes('HasReservation') ||
    types.includes('Aura') ||
    types.includes('Herald')
  ) {
    return { role: 'aura' };
  }
  if (types.some((t) => t === 'Curse' || t === 'Mark' || t === 'Hex')) return { role: 'curse' };
  if (isMain) return { role: 'primary' };
  if (types.includes('Cooldown')) return { role: 'burst' };
  if (types.some((t) => t === 'Movement' || t === 'Travel')) {
    return { role: 'movement' };
  }
  if (MOVEMENT_NAME_RE.test(name)) {
    return { role: 'movement', unverified: 'мув-скилл по эвристике имени — проверь в игре' };
  }
  if (types.some((t) => t === 'Buff')) return { role: 'buff', unverified: 'тег Buff из офлайн-датасета' };
  if (!det) return { role: 'unknown' };
  return { role: 'secondary' };
}

/** Активные камни билда: первый камень каждой включённой группы (остальные — саппорты). */
function activeGems(b: BuildImport): Array<{ name: string; isMain: boolean; group: BuildSkillGroup }> {
  const out: Array<{ name: string; isMain: boolean; group: BuildSkillGroup }> = [];
  const seen = new Set<string>();
  for (const g of b.skillGroups ?? []) {
    if (!g.enabled || !g.gems.length) continue;
    const [active] = g.gems;
    if (!active || seen.has(active.name)) continue;
    seen.add(active.name);
    out.push({ name: active.name, isMain: !!g.main, group: g });
  }
  return out;
}

// ─── Шаблоны слотов ─────────────────────────────────────────────────────────

/**
 * Геймпад: слоты под навыки в порядке эргономики GGG (F3).
 * Слой 0 (без модификатора) — частое; слой 1 (удержание LT/модификатора) — редкое.
 */
const GAMEPAD_SKILL_SLOTS: Array<{ slot: string; ps: string; roles: KeybindRole[]; reason: string }> = [
  { slot: 'RB', ps: 'R1', roles: ['primary'], reason: 'primary на R1 — рекомендация GGG' },
  { slot: 'RT', ps: 'R2', roles: ['movement', 'secondary'], reason: 'второй по доступности триггер' },
  { slot: 'Y', ps: '△', roles: ['secondary'], reason: 'face-кнопка — быстрый доступ' },
  { slot: 'X', ps: '□', roles: ['secondary'], reason: 'face-кнопка — быстрый доступ' },
  { slot: 'B', ps: '○', roles: ['secondary', 'curse'], reason: 'face-кнопка — быстрый доступ' },
  { slot: 'LT+RB', ps: 'L2+R1', roles: ['burst'], reason: 'редкое — за модификатором (атачменты у GGG там же)' },
  { slot: 'LT+RT', ps: 'L2+R2', roles: ['burst', 'secondary'], reason: 'редкое — за модификатором' },
  { slot: 'LT+Y', ps: 'L2+△', roles: ['buff', 'unknown'], reason: 'редкое — за модификатором' },
  { slot: 'LT+X', ps: 'L2+□', roles: ['curse', 'secondary', 'unknown'], reason: 'редкое — за модификатором' },
  { slot: 'LT+B', ps: 'L2+○', roles: ['buff', 'unknown', 'secondary'], reason: 'редкое — за модификатором' },
];

const GAMEPAD_SYSTEM: KeybindSlot[] = [
  { slot: 'LB', ps: 'L1', role: 'system', system: 'Dodge Roll', reason: 'рекомендация GGG: dodge на L1' },
  { slot: 'D-Pad ▲', ps: 'D-Pad ▲', role: 'system', system: 'Any Life Flask', reason: 'рекомендация GGG: фляги на D-pad' },
  { slot: 'D-Pad ▼', ps: 'D-Pad ▼', role: 'system', system: 'Any Mana Flask', reason: 'рекомендация GGG: фляги на D-pad' },
  { slot: 'LT+◀', ps: 'L2+◀', role: 'system', system: 'Overlay Map', reason: 'рекомендация GGG: карта за модификатором' },
  { slot: 'LT+▶', ps: 'L2+▶', role: 'system', system: 'Portal Scroll', reason: 'рекомендация GGG: портал за модификатором' },
  { slot: 'A', ps: '✕', role: 'system', system: 'Interact (взаимодействие)', reason: 'стандарт консолей — не перебивать' },
];

const KEYBOARD_SYSTEM_wasd: KeybindSlot[] = [
  {
    slot: 'Space', role: 'system', system: 'Dodge Roll',
    reason: 'дефолт dodge на Space (❓)',
    unverified: 'дефолт Dodge Roll на клавиатуре НЕ сверен живьём (SPEC F5)',
  },
  {
    slot: '1–5', role: 'system', system: 'Фляги',
    reason: 'дефолт фляг 1–5 (❓)',
    unverified: 'дефолты фляг на клавиатуре НЕ сверен живьём (SPEC F5)',
  },
  {
    slot: 'X', role: 'system', system: 'Weapon Set Swap',
    reason: 'смена оружейного набора — дефолт X (дайджест keymap.io, 2026-09-07)',
    unverified: 'дефолт X НЕ сверен живьём; конфликт с загрузкой не проверен',
  },
  {
    slot: 'Mouse 3', role: 'system', system: 'Force Move',
    reason: 'только-движение на боковую кнопку мыши — клик-атаки не бьют по воздуху (дайджест keymap.io)',
    unverified: 'Mouse 3 — ДОБАВЛЕНИЕ, не дефолт игры; проверьте, что мышь поддерживает',
  },
];

/** Порядок роли → слот для клавиатуры (wasd: RMB свободен под мув, click: RMB = secondary). */
function keyboardSkillSlots(mode: KeybindMovementMode): Array<{ slot: string; roles: KeybindRole[]; reason: string }> {
  const base = [
    { slot: 'LMB', roles: ['primary' as KeybindRole], reason: 'основная атака — левая кнопка мыши' },
    mode === 'wasd'
      ? { slot: 'RMB', roles: ['movement' as KeybindRole], reason: 'WASD-режим: мув-скилл на правую кнопку' }
      : { slot: 'RMB', roles: ['secondary' as KeybindRole], reason: 'клик-мув: RMB свободна под навык' },
    { slot: 'Q', roles: ['secondary' as KeybindRole], reason: 'самая доступная из букв' },
    { slot: 'W', roles: ['secondary' as KeybindRole], reason: 'рядом с WASD-домашней позицией' },
    { slot: 'E', roles: ['secondary' as KeybindRole, 'movement' as KeybindRole], reason: 'рядом с WASD-домашней позицией' },
    { slot: 'R', roles: ['secondary' as KeybindRole, 'curse' as KeybindRole], reason: 'под большим пальцем' },
    { slot: 'T', roles: ['burst' as KeybindRole, 'curse' as KeybindRole], reason: 'дальняя буква — под редкое' },
    { slot: 'MMB', roles: ['buff' as KeybindRole, 'unknown' as KeybindRole], reason: 'средняя кнопка — под утилиту' },
  ];
  // В клик-муве движение тоже часто буквой «E» — движок ниже заполнит по ролям.
  if (mode === 'click') {
    base[4] = { slot: 'E', roles: ['movement', 'secondary'], reason: 'клик-мув: мув-скилл на букву' };
  }
  return base;
}

// ─── Ядро ───────────────────────────────────────────────────────────────────

export function adviseKeybinds(b: BuildImport, opts: KeybindsOpts = {}): KeybindAdvice {
  const platform: KeybindPlatform = opts.platform ?? 'xbox';
  const mode: KeybindMovementMode = opts.movement_mode ?? 'wasd';
  const overrides = opts.overrides ?? {};
  const unverifiedNotes: string[] = [];

  const gems = activeGems(b);
  const classified = gems.map(({ name, isMain }) => classifyRole(name, isMain, overrides));

  // Spirit-блок: ауры/херальды не биндим.
  const spirit: KeybindSpiritEntry[] = [];
  const bounded: Array<{ name: string; role: KeybindRole; unverified?: string }> = [];
  for (let i = 0; i < gems.length; i++) {
    const { name } = gems[i]!;
    const c = classified[i]!;
    if (c.role === 'aura') {
      const det = getSkillGemDetails(name);
      // PoE2: у persistent-гемов резервация — levels[0].spiritReservationFlat
      // (проверено по датасету: Herald of Ice → 30), а не cost.spirit.
      const lv0 = det?.levels?.[0] as { spiritReservationFlat?: number } | undefined;
      const cnt = lv0?.spiritReservationFlat ?? det?.firstLevelCost?.spirit ?? null;
      spirit.push({
        gem: name,
        spiritCost: cnt,
        note: 'резервирует Spirit — кастуется раз (при входе/после смерти), слот не занимает',
      });
      if (c.unverified) unverifiedNotes.push(`${name}: ${c.unverified}`);
    } else {
      bounded.push({ name, role: c.role, unverified: c.unverified });
      if (c.unverified) unverifiedNotes.push(`${name}: ${c.unverified}`);
    }
  }

  // Приоритет заполнения: primary → movement → secondary → curse → burst → buff → unknown.
  const rolePriority: Record<KeybindRole, number> = {
    primary: 0, movement: 1, secondary: 2, curse: 3, burst: 4, buff: 5, aura: 6, unknown: 7,
  };
  // №223b («имба-атаки»): data-driven признак дэмедж-скилла — теги датасета
  // (183 тега, проверено: Ice Strike = Attack, Snipe = Attack, Invocation = Spell).
  // Кэш name→details: в Node getSkillGemDetails парсит JSON при каждом вызове
  // (dataset.ts: readFileSync без кэша), а компаратор сортировки зовёт его O(n log n) раз.
  const detCache = new Map<string, ReturnType<typeof getSkillGemDetails>>();
  const detOf = (name: string): ReturnType<typeof getSkillGemDetails> => {
    let d = detCache.get(name);
    if (d === undefined) {
      d = getSkillGemDetails(name);
      detCache.set(name, d);
    }
    return d;
  };
  const isDamage = (name: string): boolean => {
    const t = detOf(name)?.skillTypes ?? [];
    // №223b: точный критерий дэмедж-скилла по data-mining всего датасета
    // (1373 записи; ~41 ложный позитив убран: курсы/бафы/Empowers-мета/Guard/
    // Damage-варкраи; Spell как самостоятельный маркер исключён — 64
    // Spell-only-матча, из них 39 без дэмедж-признаков).
    const DMG_FAM = ['Damage', 'DamageOverTime', 'DegenOnlySpellDamage', 'CausesBurning'];
    const NOT_DMG = ['EmpowersOtherSkill', 'ModifiesNextSkill', 'Guard', 'InstantShiftAttackForLeftMouse', 'DodgeReplacement'];
    const hasDmg = t.some((x) => DMG_FAM.includes(x)) && !t.includes('HasReservation');
    const hasAtk = t.includes('Attack');
    const blocked = NOT_DMG.some((x) => t.includes(x));
    return !blocked && (hasDmg || hasAtk);
  };
  // Внутри одной роли дэмедж-скиллы («имба-атаки») раньше утилити —
  // при равных ролях атакующие занимают более удобные слоты.
  // Компаратор с равным ключом возвращает 0 — sort стабильный (ES2019),
  // порядок групп PoB внутри равных (role, isDamage) сохраняется.
  bounded.sort((x, y) => {
    const d = rolePriority[x.role] - rolePriority[y.role];
    if (d !== 0) return d;
    return Number(isDamage(y.name)) - Number(isDamage(x.name));
  });

  // №223b/№223c: если main-группы в PoB нет (или main-группой назначена
  // аура/мусор) — primary-слоты (RB геймпада / LMB клавиатуры) остались бы
  // пустыми (их шаблоны принимают только primary). Каскад сигналов:
  //   1) FullDPSSkill из PoB-экспорта (Build.lua форка: per-skill DPS, движок
  //      PoB уже посчитал) — максимальный value, чьё имя матчит камень билда;
  //   2) fallback: первый по порядку (роль → дэмедж) дэмедж-скилл без тегов
  //      Cooldown/Travel/Movement и без ролей curse/buff/unknown/movement.
  // mainSocketGroup у PoB2 дефолтится в 1 при бездействии автора — слепо
  // доверять нельзя (первая группа часто аура), поэтому каскад, а не «группа №1».
  const promote = (idx: number, why: string): void => {
    const promoted = bounded[idx]!;
    bounded[idx] = {
      ...promoted,
      role: 'primary',
      // слот-пометка — только причина promote: исходная эвристика гема
      // уже попала в unverifiedNotes на шаге bounded-заполнения, дубль не нужен.
      unverified: why,
    };
    unverifiedNotes.push(`${promoted.name}: ${why}`);
  };
  if (!bounded.some((x) => x.role === 'primary')) {
    // 1) FullDPSSkill: stat вида "2x Ice Strike" — матчим подстрокой имени.
    const fdBest = (b.fullDps ?? [])
      .filter((x) => bounded.some((g) => g.name && x.stat.includes(g.name)))
      .sort((x, y) => y.value - x.value)[0];
    const fdIdx = fdBest
      ? bounded.findIndex((x) => x.role !== 'curse' && x.role !== 'buff' && x.role !== 'unknown' && fdBest.stat.includes(x.name))
      : -1;
    if (fdIdx >= 0) {
      promote(fdIdx, `имба-атака по FullDPSSkill PoB (${fdBest!.stat.trim()}: ${Math.round(fdBest!.value)} DPS)`);
    } else {
      // 2) Теговый fallback по датасету.
      const idx = bounded.findIndex((x) => {
        if (x.role === 'curse' || x.role === 'buff' || x.role === 'unknown' || x.role === 'movement') return false;
        const t = detOf(x.name)?.skillTypes ?? [];
        return isDamage(x.name) && !t.includes('Cooldown') && !t.includes('Travel') && !t.includes('Movement');
      });
      if (idx >= 0) promote(idx, 'повышен до primary автоматически (main-группа не помечена в PoB)');
    }
  }

  const assignments: KeybindSlot[] = [];
  const unassigned: string[] = [];

  if (platform === 'keyboard') {
    const only = bounded;
    for (const g of only) {
      const tpl = keyboardSkillSlots(mode).find(
        (t) => t.roles.includes(g.role) && !assignments.some((a) => a.slot === t.slot),
      );
      if (!tpl) {
        // Свободный слот по порядку.
        const fallbackTpl = keyboardSkillSlots(mode).find((t) => !assignments.some((a) => a.slot === t.slot));
        if (!fallbackTpl) {
          unassigned.push(g.name);
          continue;
        }
        assignments.push({ slot: fallbackTpl.slot, role: g.role, gem: g.name, reason: 'место кончилось — наименее частый слот', unverified: g.unverified });
        continue;
      }
      assignments.push({ slot: tpl.slot, role: g.role, gem: g.name, reason: tpl.reason || 'следующий по доступности', unverified: g.unverified });
    }
    const sysList = KEYBOARD_SYSTEM_wasd.map((s) => {
      if (!unverifiedNotes.includes(s.unverified ?? '') && s.unverified) unverifiedNotes.push(s.unverified);
      return s;
    });
    return {
      platform,
      assignments,
      system: sysList,
      free: [],
      spirit,
      totalSlots: assignments.length + unassigned.length + sysList.length,
      manual: [
        'Открой Настройки → Управление (Keybindings) и назначь каждому навыку клавишу из таблицы.',
        'Ауры/херальды: кастуй раз при входе в зону — бинд на хотбар не нужен.',
      ],
      unassigned,
      unverifiedNotes,
    };
  }

  // Геймпад (xbox / playstation): та же физическая раскладка, рендер-деталь нотации.
  const ps = platform === 'playstation';
  // №222 (баг): assignments хранят слот в нотации платформы (PS: 'R2'), поэтому
  // все сверки — тоже в нотации платформы, иначе на PlayStation дубль-чек
  // не срабатывает ('R2' !== 'RT') и два навыка получают один слот.
  const slotOf = (t: { slot: string; ps?: string }): string => (ps ? t.ps ?? t.slot : t.slot);
  for (const g of bounded) {
    const tpl = GAMEPAD_SKILL_SLOTS.find(
      (t) => t.roles.includes(g.role) && !assignments.some((a) => a.slot === slotOf(t)),
    );
    if (!tpl) {
      unassigned.push(g.name);
      continue;
    }
    assignments.push({
      slot: slotOf(tpl),
      ps: ps ? tpl.slot : tpl.ps,
      role: g.role,
      gem: g.name,
      reason: tpl.reason,
      unverified: g.unverified,
    });
  }

  const used = new Set(assignments.map((a) => a.slot));
  const system = GAMEPAD_SYSTEM.filter((s) => !used.has(slotOf(s)));
  const free: KeybindSlot[] = GAMEPAD_SKILL_SLOTS
    .filter((t) => !assignments.some((a) => a.slot === slotOf(t)))
    .map((t) => ({
      slot: slotOf(t),
      ps: ps ? t.slot : t.ps,
      role: 'free' as const,
      reason: 'свободно — запас под рост билда',
    }));

  // 22 слота (F1): занятые навыки + системы (в наших шаблонах) — остальное честно «свободно».
  return {
    platform,
    assignments,
    system,
    free,
    spirit,
    totalSlots: 22,
    manual: [
      'Инвентарь → Skills → выбери навык → «Set Skill Bind» → нажми кнопку геймпада.',
      'Или пауза → radial-меню → «Bind Screen»: перетащи навык (drag-n-drop) в любой свободный слот.',
      'Ауры/херальды: кастуй раз при входе в зону — слот хотбара не нужен.',
    ],
    unassigned,
    unverifiedNotes,
  };
}

// ─── Markdown-рендер (MCP-тул) ──────────────────────────────────────────────

export function keybindsToMarkdown(a: KeybindAdvice): string {
  const isPad = a.platform === 'xbox' || a.platform === 'playstation';
  const lines: string[] = [];
  lines.push(`## Раскладка (${a.platform === 'keyboard' ? 'клавиатура' : a.platform === 'playstation' ? 'PlayStation' : 'Xbox'})`);
  lines.push('');
  lines.push('| Слот | Навык | Роль | Почему |');
  lines.push('|---|---|---|---|');
  for (const s of a.assignments) {
    const slot = isPad && s.ps ? `${s.slot} (${s.ps})` : s.slot;
    lines.push(`| **${slot}** | ${s.gem ?? '—'} | ${s.role} | ${s.reason}${s.unverified ? ` ⚠️ ${s.unverified}` : ''} |`);
  }
  lines.push('');
  if (a.system.length) {
    lines.push('**Системные слоты (не занимать):**');
    for (const s of a.system) {
      const slot = isPad && s.ps ? `${s.slot} (${s.ps})` : s.slot;
      lines.push(`- ${slot} — ${s.system}${s.unverified ? ` ⚠️ ${s.unverified}` : ''}`);
    }
    lines.push('');
  }
  if (a.free.length) {
    lines.push(`**Свободно слотов:** ${a.free.length} — запас под рост билда.`);
    lines.push('');
  }
  if (a.spirit.length) {
    lines.push('**Spirit-блок (НЕ биндить — каст раз):**');
    for (const s of a.spirit) {
      lines.push(`- ${s.gem}${s.spiritCost != null ? ` (−${s.spiritCost} Spirit)` : ''} — ${s.note}`);
    }
    lines.push('');
  }
  if (a.unassigned.length) {
    lines.push(`**Без слота (укажи вручную):** ${a.unassigned.join(', ')}.`);
    lines.push('');
  }
  lines.push('**Как выставить в игре:**');
  lines.push(...a.manual.map((m, i) => `${i + 1}. ${m}`));
  if (a.unverifiedNotes.length) {
    lines.push('');
    lines.push('**⚠️ Не сверено с игрой (помечены в таблице):**');
    lines.push(...a.unverifiedNotes.map((n) => `- ${n}`));
  }
  return lines.join('\n');
}
