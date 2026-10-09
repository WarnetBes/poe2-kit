/**
 * №239/Phase-2 «Simulacrum» — данные гайда по активности Delirium в PoE2 0.5.x
 * + офлайн-генератор markdown (MCP-тул poe2_simulacrum_guide, web-вкладка рендерит те же данные).
 *
 * Источник данных — 5-агентный ресёрч 09.10.2026:
 *   _research/poe2_simulacrum_research.md, _research/simulacrum_loot_0.5.md,
 *   _research/simulacrum_strategy_0.5.md, docs/design_simulacrum_tab.md.
 *
 * Дисциплина честности (механизмы №236/№222): спорные факты не выбрасываем и
 * не выдаём за подтверждённые — каждое поле `unverified` несёт причину
 * (расхождение источников / сэмпл / нет официальных данных). Числа — только
 * из досье. Модуль офлайн: ни одного внешнего запроса.
 *
 * Формат волны/Deliriousness: официально известны ТОЛЬКО границы 100% (старт)
 * и 200% (волна 7); промежуточные значения показаны условно, danger-бар —
 * наша расчётная оценка (волна/7), НЕ игровое число.
 */

// ─── Типы ─────────────────────────────────────────────────────────────────────

export interface SimFact {
  value: string;
  label: string;
  unverified?: string;
}

export interface SimWaveEvent {
  text: string;
  unverified?: string;
}

export interface SimWave {
  wave: number;
  /** Условный показ: официально известны только границы 100% и 200%. */
  deliriousness: string;
  /** Расчётная оценка 0..10, не игровое число. */
  danger: number;
  events: SimWaveEvent[];
}

export interface SimShard {
  name: string;
  effect: string;
  rec: string;
  danger: number;
}

export interface SimBossAttack {
  attack: string;
  telegraph: string;
  response: string;
  danger: number;
}

export interface SimBoss {
  name: string;
  sub: string;
  tags: string[];
  attacks: SimBossAttack[];
  note: string;
  noteUnverified?: string;
}

export interface SimLootRow {
  reward: string;
  source: string;
  kind: 'валюта' | 'уник' | 'ключ' | 'прогресс';
  note: string;
  unverified?: string;
}

export interface SimAtlasNode {
  name: string;
  req: string;
  effect: string;
  priority: 'mandatory' | 'high' | 'nice';
}

export interface SimTip {
  title: string;
  body: string[];
}

export interface SimAccessStep {
  text: string;
  unverified?: string;
}

// ─── B0. Fact-box ──────────────────────────────────────────────────────────

export const SIM_FACTS: SimFact[] = [
  { value: '7', label: 'волн (PoE2 0.5; «30» — PoE1, «15» — pre-0.5)' },
  { value: '300', label: 'сплинтеров = вход (стак 1/300)' },
  { value: '100→200%', label: 'Deliriousness за ран (офиц. 0.5.3)' },
  { value: '3–5', label: 'волна появления боссов', unverified: 'источники расходятся' },
  { value: '1–2', label: "Raven's Reflection с финала → Tang'Mazu" },
];

// ─── B1. Цепочка доступа ──────────────────────────────────────────────────────

export const SIM_ACCESS_STEPS: SimAccessStep[] = [
  {
    text: '**Delirium Mirror** в карте (Delirium Tablet / мод вейстоуна) — пройди сквозь зеркало и убивай в тумане, не отставая от фронта >4 сек. Сплинтеры и Liquid Emotions начисляются в конце энкаунтера по Reward Bar (не валяются на земле).',
  },
  {
    text: '**Grand Mirror**: убийство босса карты внутри тумана с шансом спавнит Grand Mirror на соседней карте. Внутри — зеркальный двойник босса; после убийства обоих туман расползается по региону (Fog Bank).',
    unverified: 'точный шанс GGG не публиковал',
  },
  {
    text: '**Fog Bank → 100% Deliriousness**: туманные карты стартуют с 10%, убийства редких/боссов греют банк (максимум 200%). При 100% одна из карт региона становится **Simulacrum**.',
  },
  {
    text: '**Предмет Simulacrum** (300 сплинтеров, авто-стак): применяется к делириумной ноде атласа (НЕ Map Device).',
    unverified: 'Realmgate-уровни 50/100/150 сплинтеров (Normal/Cruel/Merciless) vs ПКМ-по-ноде — источники конфликтуют, нужна живая сверка',
  },
  {
    text: "**Финал волны 7 → Mirror of Madness → лут + 1–2 Raven's Reflection → Tang'Mazu** в The Withered Willow.",
  },
];

export const SIM_ACCESS_NOTE: string =
  'Сплинтеры падают только в картах level 75+ (T11+) и только при взятой ноде «Is this about me... or you?». Квестовая линия «The Hare and the Raven» (Elder Madox) даёт первый, квестовый Simulacrum.';

// ─── B2. Волны + шарды ────────────────────────────────────────────────────────

export const SIM_WAVES: SimWave[] = [
  { wave: 1, deliriousness: '100%', danger: 2, events: [{ text: '▶️ старт: клик по Trial of Suffering' }] },
  { wave: 2, deliriousness: '↑', danger: 3, events: [] },
  {
    wave: 3,
    deliriousness: '↑',
    danger: 4,
    events: [
      {
        text: '👹 боссы возможны (Omniphobia / Kosis)',
        unverified: 'источники расходятся: с 3-й или с 5-й волны (timesaver/mobalytics/switchblade)',
      },
    ],
  },
  { wave: 4, deliriousness: '↑', danger: 5, events: [{ text: '👹 боссы возможны' }] },
  {
    wave: 5,
    deliriousness: '↑',
    danger: 6,
    events: [{ text: '👹 боссы возможны' }, { text: '🧪 концентрированные Liquid Emotions (наблюдения)' }],
  },
  { wave: 6, deliriousness: '↑', danger: 7, events: [{ text: '🧪 Potent Liquid Emotions (наблюдения)' }] },
  {
    wave: 7,
    deliriousness: '200%',
    danger: 10,
    events: [
      { text: '🏆 Mirror of Madness: лут-ливень' },
      { text: "🪞 1–2× Raven's Reflection" },
      { text: '🗺 +2 Delirium Atlas-очка за первое прохождение' },
    ],
  },
];

export const SIM_WAVES_NOTE: string =
  'Официально известны только границы: 100% (старт) и 200% (волна 7); «+5%/волна» из гайдов противоречит 100→200 за 7 волн — прирост не опубликован. Опасность — наша расчётная оценка по номеру волны, не игровое число. Случайные негативные wave-моды удалены в 0.5.3 (заменены выбором шардов).';

export const SIM_SHARDS_NOTE: string =
  "Требуется нода «You can't just wake up from this one.»; мультивыбор — нода «Are you sure you want to do that?» (20%).";

export const SIM_SHARDS: SimShard[] = [
  {
    name: '👹 Apex Predators',
    effect: '+1 босс к этой и всем следующим волнам',
    rec: 'консенсус: брать почти всегда — боссы двигают Reward bar и лут сильнее всего',
    danger: 7,
  },
  {
    name: '⚔️ Escalating Threats',
    effect: '+1 модификатор района на все оставшиеся волны',
    rec: 'при мультивыборе (нода «Are you sure you want to do that?») — второй выбор',
    danger: 6,
  },
  {
    name: '🐺 Pure Emotions',
    effect: 'доп. паки монстров',
    rec: 'последними: плотность растёт, но уровень риска/награды хуже боссов',
    danger: 4,
  },
];

// ─── B3. Боссы ─────────────────────────────────────────────────────────────────

export const SIM_BOSSES: SimBoss[] = [
  {
    name: 'Kosis, The Revelation',
    sub: 'кастовый босс тумана — главная угроза волн',
    tags: ['Demon Beam', 'Chaos DoT', 'дальний бой'],
    attacks: [
      {
        attack: 'Demon Beam (ченнел-луч)',
        telegraph: 'чёрный луч из живота — телеграфирован, но убивает',
        response: 'уйти вбок ДО начала луча; параллельно лучу не бежать',
        danger: 10,
      },
      {
        attack: 'Chaos DoT-поля',
        telegraph: 'тёмные зоны на полу',
        response: 'выйти из зоны; chaos-резист ≥ 60% сильно помогает',
        danger: 7,
      },
    ],
    note: 'Может заспавниться более одного раза за ран и одновременно с Omniphobia. Убийство сильно продвигает Reward bar.',
    noteUnverified: 'Волны спавна 3–5+ — источники расходятся.',
  },
  {
    name: 'Omniphobia, Fear Manifest',
    sub: 'милишный босс тумана',
    tags: ['gap-closer', 'melee'],
    attacks: [
      {
        attack: 'Gap-closer рывки',
        telegraph: 'замах и резкое сокращение дистанции',
        response: 'держать дистанцию, кайтить; не стоять вплотную',
        danger: 7,
      },
    ],
    note: 'Менее опасен, чем Kosis, но в паре требует приоритета. Роняет большой стак сплинтеров.',
  },
  {
    name: "Tang'Mazu, The Raven Trickster",
    sub: "pinnacle: Raven's Reflection → The Withered Willow (area level 79)",
    tags: ['мультифаза', 'зеркала', 'скрипт-хил'],
    attacks: [
      {
        attack: 'Скрипт-хил → центральный взрыв',
        telegraph: 'босс «исцеляется» и заряжает взрыв',
        response: 'взрыв НЕ роллится — только выбежать; не дамажить через хил',
        danger: 10,
      },
      {
        attack: 'Spawn Floating Mirrors',
        telegraph: 'зеркала появляются вокруг арены',
        response: 'зеркала редиректят стихии — не кастовать элем-скиллы в них',
        danger: 8,
      },
      {
        attack: 'Mirror Beam (5 стихий) / Refraction Beam',
        telegraph: 'луч по площади, отражается от зеркал',
        response: 'разорвать линию зеркало→игрок',
        danger: 8,
      },
      {
        attack: 'Двойник-иллюзия',
        telegraph: 'какой из двух боссов — не очевидно',
        response: 'настоящий — с падающим HP-баром; не гнаться за двойником',
        danger: 6,
      },
    ],
    note: "Raven's Reflection (1–2 шт с финала, ~80% ×1 / ~20% ×2) — вход к бою: принести к зеркалу в The Withered Willow. Главная дропля: Raven-Touched Shard (~1/40, ~97% профита Tangmazu-фарма 🧪) и стафф The Raven's Flock.",
    noteUnverified: '~7M HP, резисты 0/0/0/0, Life 990% + ES 10% — датамайн репо (bosses.ts), live-сверки не было.',
  },
];

// ─── B4. Лут ────────────────────────────────────────────────────────────────────

export const SIM_LOOT: SimLootRow[] = [
  {
    reward: 'Liquid Emotions (10+ типов)',
    source: 'каждая волна, минимум 1',
    kind: 'валюта',
    note: 'PoE2-имя «Liquid», НЕ «Distilled» (PoE1). Валюта для крафта и Deliriousness; добавляемый Deliriousness разный: Ire 7% … Isolation 50%.',
  },
  {
    reward: 'Концентрированные / Potent Liquid Emotions',
    source: 'поздние волны / босс-волны',
    kind: 'валюта',
    note: "с 3–4 и 5–6 волн; нода «You can't scare me anymore!» форсит Potent-типы по видам монстров.",
    unverified: 'номера волн — наблюдения гайдов, официальных нет',
  },
  {
    reward: 'Assailum (Closed Helm)',
    source: 'финал, гарантированный пул',
    kind: 'уник',
    note: '~42% по сэмплу wiki (n=59). Armour/Evasion + Accuracy + Crit, окно Perfect Timing.',
    unverified: 'рейт — сэмпл',
  },
  {
    reward: 'Megalomaniac (Diamond jewel)',
    source: 'финал / Kosis-волны',
    kind: 'уник',
    note: 'С 0.5.0 падает identified: аллоцирует 3 случайных нотабла. Цена сильно зависит от выпавших нотаблов.',
  },
  {
    reward: 'Voices (Sapphire jewel, Corrupted)',
    source: 'финал, редкий',
    kind: 'уник',
    note: 'Падает UNIDENTIFIED — гэмбл: 2–4 Sinister-сокета. ~1/100–150 ранов; 2 soc ~сотни div, 4 soc ~1000–1800 div. Практически весь профит фарма — этот джекпот; без него EV ≈ 0.',
    unverified: 'рейты и цены — сэмплы игроков',
  },
  {
    reward: 'Прочие финал-уники',
    source: 'финал',
    kind: 'уник',
    note: 'Collapsing Horizon, Melting Maelstrom, Perfidy, Strugglescream (poe2db, Delirium Unique pool).',
  },
  {
    reward: "Raven's Reflection ×1–2",
    source: 'финал (~80% ×1 / ~20% ×2)',
    kind: 'ключ',
    note: "Вход к Tang'Mazu: принести к зеркалу в The Withered Willow.",
    unverified: 'распределение 80/20 — сэмпл',
  },
  {
    reward: "Tangmazu's Reliquary Key",
    source: 'финал, <1%',
    kind: 'ключ',
    note: 'Открывает Reliquary-портал.',
    unverified: 'единичные сэмплы',
  },
  {
    reward: '+2 Delirium Atlas Passive Points',
    source: 'финал, первое прохождение',
    kind: 'прогресс',
    note: '«First time complete grants 2 points» (poe2db); Deranging Books of Knowledge I–IV дают ещё +2 каждая.',
  },
  {
    reward: 'Splinters / Delirium Tablets',
    source: 'волны, боссы тумана',
    kind: 'валюта',
    note: 'Omniphobia/Kosis роняют большой стак сплинтеров; мод «+30% Stack size of Simulacrum Splinters» ускоряет намывку.',
  },
];

export const SIM_LOOT_NOTE: string =
  'Честно: почти весь профит фарма — Voices-джекпот; без него EV ≈ 0 (сэмплы 🧪, официальных данных нет). Headhunter в PoE2 НЕ привязан к Simulacrum (world-drop/Ritual); Catalysts в PoE2 отсутствуют.';

// ─── B5. Стратегии ─────────────────────────────────────────────────────────────

export const SIM_TIPS: SimTip[] = [
  {
    title: 'Стоит ли вообще заходить',
    body: [
      'Вход ~3 div (300 сплинтеров). Фарм самоокупается (~1.15 raw div/прогон, 35–50 div/h по 100-ран отчёту 🧪), но почти весь профит — Voices-джекпот (~1/100–150 ранов).',
      'T15 Rarity+Effectiveness ≈ T16 по дропу, но дешевле — бюджетный вариант фарма.',
      'Легальная стратегия осторожного игрока: продать сплинтеры, не заходить.',
    ],
  },
  {
    title: 'Выбор шардов по билду',
    body: [
      'AoE/clear-билду комфортнее паки (Pure Emotions), но консенсус: боссы (Apex Predators) почти всегда — они двигают Reward bar и лут сильнее.',
      'При мультивыборе (нода, 20%) — босс + Escalating Threats.',
    ],
  },
  {
    title: 'Смерть, порталы, тайминги',
    body: [
      '1 «бесплатная» смерть на ран, вторая = конец попытки — только вторичные источники.',
      'Один портал; данные по ре-входу отсутствуют — не рассчитывай на возврат.',
      'Между волнами передышка: следующая волна стартует твоим кликом по Trial of Suffering — подбирай лут ДО запуска.',
    ],
  },
  {
    title: 'Топ-5 причин смерти',
    body: [
      "1. Бежать ПАРАЛЛЕЛЬНО Demon Beam Kosis (надо уходить вбок, до старта луча).",
      "2. Дамажить Tang'Mazu через скрипт-хил → поймать нероллируемый центральный взрыв.",
      '3. Гнаться за двойником-иллюзией (настоящий — с падающим HP-баром).',
      '4. Игнорировать Omniphobia в паре с Kosis — gap-closer ловит, пока ты занят лучом.',
      '5. Хилиться стоя в DoT-поле вместо выхода в чистую зону.',
    ],
  },
];

// ─── B6. Атлас-ноды Delirium ─────────────────────────────────────────────────────

export const SIM_ATLAS_NODES: SimAtlasNode[] = [
  {
    name: 'Is this about me... or you?',
    req: 'после первого Simulacrum',
    effect: 'БЕЗ ноды сплинтеры НЕ падают вообще (карты level 75+ / T11+); Megalomaniac: 10% шанс аллоцировать 3 нотабла',
    priority: 'mandatory',
  },
  {
    name: "You can't just wake up from this one.",
    req: '—',
    effect: 'Туман рассеивается на 30% медленнее; Simulacrum спавнит Fracturing Shards между волнами (выбор 1 из 3)',
    priority: 'high',
  },
  {
    name: 'Are you sure you want to do that?',
    req: 'активировать Grand Mirror',
    effect: 'Карты с Grand Mirror также имеют Delirium Mirror; 20% шанс мультивыбора шардов',
    priority: 'high',
  },
  {
    name: 'You thought you were free?',
    req: 'после первого Simulacrum',
    effect: '25% шанс доп. Simulacrum при достижении туманом 100% Deliriousness',
    priority: 'high',
  },
  {
    name: 'I see your true nature now!',
    req: 'активировать Grand Mirror',
    effect: 'Fog может заспавнить шард: доп. босс в арене Map Boss ИЛИ гарантированный Grand Mirror',
    priority: 'high',
  },
  {
    name: 'Recurring Nightmares (keystone)',
    req: 'убить Delirium pinnacle-босса',
    effect: 'Fog от Grand Mirrors: +30% Deliriousness, распространение на +4 карты',
    priority: 'nice',
  },
  {
    name: "You can't scare me anymore!",
    req: 'активировать Grand Mirror',
    effect: 'Unique-монстры в Fog: 5% шанс Potent Liquid Emotions по типу (Humanoids→Melancholy, Beasts→Ferocity, Constructs→Contempt)',
    priority: 'nice',
  },
];

export const SIM_ATLAS_NOTE: string =
  'Полное дерево — вкладка «Атлас» (субтри Delirium, 32 узла; полные тексты и планирование очков — там). Порядок аллокации, консенсус гайдов: обязательная для сплинтеров → шарды между волнами → мультивыбор → «I see your true nature…» → Recurring Nightmares.';

// ─── B7. Чек-лист ────────────────────────────────────────────────────────────────

export const SIM_CHECKLIST: string[] = [
  '300 сплинтеров собраны (стак 1/300, авто-комбинируется в предмет)',
  'Взята атлас-нода «Is this about me... or you?» — иначе сплинтеры не падают',
  'Chaos-резист ≥ 60% (Chaos DoT Kosis)',
  'Билд держит Deliriousness 200% (toughness/damage монстров растут по волнам)',
  'Определена стоп-волна: с какой волны билд перестаёт справляться',
  'Фляги/сустан готовы: затяжные бои волн 5–7',
  "Знаешь механику Tang'Mazu: хил-взрыв НЕ роллится, только выбежать",
];

export const SIM_FOOTNOTE: string =
  'Данные — PoE2 0.5.x по состоянию на 09.10.2026; «unverified» = требует живой сверки с игрой (см. досье в _research/). Патч GGG может всё поменять.';

// ─── Б8. Известные баги (open) — из баг-дайджеста 09.10.2026 ──────────────────

export interface SimKnownIssue {
  issue: string;
  workaround: string;
  status: string;
  unverified?: string;
  /** Даты community-репортов (из data-файла, для сверки с патчами GGG). */
  report_dates?: string[];
}

export interface SimOpenQuestion {
  question: string;
  check_condition: string;
  as_of?: string;
}

export interface SimFactsMeta {
  patch?: string;
  as_of?: string;
  sources?: string[];
  note?: string;
}

export interface SimFactsFile {
  _meta?: SimFactsMeta;
  known_issues?: unknown;
  open_questions?: unknown;
}

/**
 * Data-слой (Этап 3, №247): known-issues и open-questions живут в
 * data/game/guides/simulacrum_facts.json — обновляются при патчах GGG
 * без правок кода. Файл импортируется статически (bundle-inline): тот же
 * массив виден и в Node (MCP/тесты/скрипты), и в браузере (web-вкладка
 * рендерит SIM_KNOWN_ISSUES через vite-бандл; readFileSync-паттерн тут
 * НЕ годится — в браузере HAS_DISK=false и блок багов молча исчез бы).
 */
import factsFile from '../data/game/guides/simulacrum_facts.json' with { type: 'json' };

/**
 * Чистая нормализация data-файла: битые/пустые записи честно
 * отфильтровываются (пустой known_issues = «багов не зафиксировано»,
 * НЕ ошибка). Экспортирована для тестов пустого/битого файла.
 */
export function parseSimulacrumFacts(raw: unknown): {
  meta: SimFactsMeta;
  knownIssues: SimKnownIssue[];
  openQuestions: SimOpenQuestion[];
} {
  const r = (raw ?? {}) as SimFactsFile;
  const meta: SimFactsMeta = r._meta ?? {};
  const knownIssues: SimKnownIssue[] = (Array.isArray(r.known_issues) ? r.known_issues : []).filter(
    (k): k is SimKnownIssue =>
      !!k &&
      typeof k === 'object' &&
      typeof (k as SimKnownIssue).issue === 'string' &&
      (k as SimKnownIssue).issue.trim().length > 0 &&
      typeof (k as SimKnownIssue).workaround === 'string' &&
      typeof (k as SimKnownIssue).status === 'string',
  );
  const openQuestions: SimOpenQuestion[] = (Array.isArray(r.open_questions)
    ? r.open_questions
    : []
  ).filter(
    (q): q is SimOpenQuestion =>
      !!q &&
      typeof q === 'object' &&
      typeof (q as SimOpenQuestion).question === 'string' &&
      (q as SimOpenQuestion).question.trim().length > 0 &&
      typeof (q as SimOpenQuestion).check_condition === 'string',
  );
  return { meta, knownIssues, openQuestions };
}

const PARSED_FACTS = parseSimulacrumFacts(factsFile);

/** Мета data-файла (patch/as_of/sources — для сверки свежести с патчами GGG). */
export const SIM_FACTS_META: SimFactsMeta = PARSED_FACTS.meta;

/** Известные баги (open) Simulacrum 0.5.x — из data-файла, обратная совместимость: имя как в №244. */
export const SIM_KNOWN_ISSUES: SimKnownIssue[] = PARSED_FACTS.knownIssues;

/** Открытые вопросы на перепроверку при патче (очередь живой сверки, досье §7). */
export const SIM_OPEN_QUESTIONS: SimOpenQuestion[] = PARSED_FACTS.openQuestions;

// ─── Markdown-генератор (MCP-тул) ────────────────────────────────────────────────

export type SimSection =
  | 'all'
  | 'overview'
  | 'access'
  | 'waves'
  | 'bosses'
  | 'loot'
  | 'strategy'
  | 'atlas'
  | 'checklist';

export const SIM_SECTIONS: SimSection[] = [
  'all',
  'overview',
  'access',
  'waves',
  'bosses',
  'loot',
  'strategy',
  'atlas',
  'checklist',
];

/** danger 0..10 → текстовая шкала для markdown (медиа-независимый рендер sevBar). */
export function simDangerBar(danger: number): string {
  const d = Math.max(0, Math.min(10, Math.round(danger)));
  return `${'█'.repeat(d)}${'░'.repeat(10 - d)} ${d}/10`;
}

function uv(note?: string): string {
  return note ? ' ⚠️*(unverified: ' + note + ')*' : '';
}

const PRIORITY_RU: Record<SimAtlasNode['priority'], string> = {
  mandatory: 'обязательная',
  high: 'высокий',
  nice: 'опционально',
};

/**
 * Гайд Simulacrum в markdown, офлайн. `section` — нужный блок или 'all'.
 * Возвращает null для неизвестной секции (не молчим и не выдумываем).
 */
export function simulacrumGuideMarkdown(section: SimSection = 'all'): string | null {
  const s = section;
  if (!SIM_SECTIONS.includes(s)) return null;
  const out: string[] = [];
  const want = (x: SimSection): boolean => s === 'all' || s === x;

  out.push('# 🌀 Simulacrum — гайд (PoE2 0.5.x, офлайн)');
  out.push('');

  if (want('overview')) {
    out.push('## Ключевые факты');
    for (const f of SIM_FACTS) out.push(`- **${f.value}** — ${f.label}${uv(f.unverified)}`);
    out.push('');
  }

  if (want('access')) {
    out.push('## 🔗 Как попасть');
    SIM_ACCESS_STEPS.forEach((st, i) => out.push(`${i + 1}. ${st.text}${uv(st.unverified)}`));
    out.push('');
    out.push(`> ${SIM_ACCESS_NOTE}`);
    out.push('');
  }

  if (want('waves')) {
    out.push('## 🌊 Волны (7)');
    out.push('');
    out.push('| Волна | Deliriousness | Опасность (расчёт) | События |');
    out.push('|---|---|---|---|');
    for (const w of SIM_WAVES) {
      const ev = w.events.map((e) => e.text + uv(e.unverified)).join('; ');
      out.push(`| ${w.wave} | ${w.deliriousness} | ${simDangerBar(w.danger)} | ${ev || '—'} |`);
    }
    out.push('');
    out.push(`> ${SIM_WAVES_NOTE}`);
    out.push('');
    out.push('### Fracturing Shards (выбор между волнами)');
    out.push('');
    out.push(`> ${SIM_SHARDS_NOTE}`);
    for (const sh of SIM_SHARDS) {
      out.push(`- **${sh.name}** (${simDangerBar(sh.danger)}): ${sh.effect}. Рекомендация: ${sh.rec}`);
    }
    out.push('');
  }

  if (want('bosses')) {
    out.push('## 👹 Боссы');
    for (const b of SIM_BOSSES) {
      out.push('');
      out.push(`### ${b.name}`);
      out.push(`*${b.sub}. Теги: ${b.tags.join(', ')}.*`);
      out.push('');
      out.push('| Атака | Телеграф | Ответ | Опасность |');
      out.push('|---|---|---|---|');
      for (const a of b.attacks) {
        out.push(`| **${a.attack}** | ${a.telegraph} | ${a.response} | ${simDangerBar(a.danger)} |`);
      }
      out.push('');
      out.push(`> ${b.note}${uv(b.noteUnverified)}`);
    }
    out.push('');
  }

  if (want('loot')) {
    out.push('## 💰 Лут и экономика');
    out.push('');
    out.push('| Награда | Источник | Тип | Заметки |');
    out.push('|---|---|---|---|');
    for (const l of SIM_LOOT) {
      out.push(`| **${l.reward}** | ${l.source} | ${l.kind} | ${l.note}${uv(l.unverified)} |`);
    }
    out.push('');
    out.push(`> ${SIM_LOOT_NOTE}`);
    out.push('');
  }

  if (want('strategy')) {
    out.push('## 🧭 Стратегии');
    for (const t of SIM_TIPS) {
      out.push('');
      out.push(`### ${t.title}`);
      for (const b of t.body) out.push(`- ${b}`);
    }
    out.push('');
  }

  if (want('atlas')) {
    out.push('## 🗺 Атлас-ноды Delirium');
    out.push('');
    out.push('| Нода | Разблокировка | Эффект | Приоритет |');
    out.push('|---|---|---|---|');
    for (const n of SIM_ATLAS_NODES) {
      out.push(`| **${n.name}** | ${n.req} | ${n.effect} | ${PRIORITY_RU[n.priority]} |`);
    }
    out.push('');
    out.push(`> ${SIM_ATLAS_NOTE}`);
    out.push('');
  }

  if (want('checklist')) {
    out.push('## ⚖️ Готовность — чек-лист перед входом');
    out.push('');
    out.push('### ⚠️ Известные баги (open, 0.5.x)');
    for (const k of SIM_KNOWN_ISSUES) {
      out.push(`- **${k.issue}**`);
      out.push(`  - Воркараунд: ${k.workaround}`);
      out.push(`  - Статус: ${k.status}${uv(k.unverified)}`);
    }
    out.push('');
    for (const c of SIM_CHECKLIST) out.push(`- [ ] ${c}`);
    out.push('');
  }

  // Хвост 'all': открытые вопросы (очередь перепроверки при патче) — №247/Этап 3.
  if (s === 'all' && SIM_OPEN_QUESTIONS.length) {
    out.push('### ❓ Открытые вопросы (на перепроверку)');
    out.push('');
    for (const q of SIM_OPEN_QUESTIONS) {
      const asOf = q.as_of ? ` *(as_of: ${q.as_of})*` : '';
      out.push(`- **${q.question}**`);
      out.push(`  - Проверка: ${q.check_condition}${asOf}`);
    }
    out.push('');
  }

  out.push('---');
  out.push(`*${SIM_FOOTNOTE}*`);
  return out.join('\n');
}
