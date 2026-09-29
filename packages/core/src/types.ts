/** Общие типы ядра PoE2 Kit */

export interface League {
  /** ID лиги (например, "Runes of Aldur"). Совпадает с ShortName-декодом poe2scout. */
  id: string;
  /** Отображаемое имя лиги. */
  name: string;
  /** ShortName из poe2scout (используется в URL API). Может совпадать с id. */
  shortName?: string;
  /** Текущая (активная) лига. */
  isCurrent?: boolean;
  /** Код базовой валюты лиги (например, "exalted"). */
  baseCurrencyApiId?: string;
  /** Текст базовой валюты (например, "Exalted Orb"). */
  baseCurrencyText?: string;
  /** Сколько единиц базовой валюты стоит 1 Divine Orb. */
  divinePrice?: number | null;
  /** Сколько Chaos стоит 1 Divine Orb. */
  chaosDivinePrice?: number | null;
  /** Временная метка, когда список/данные лиги были обновлены. */
  updatedAt?: number;
}

export interface CurrencyRate {
  /** Код/название валюты, например "Divine Orb" */
  name: string;
  /** Цена в Chaos Orbs */
  chaosValue: number | null;
  /** Цена в Divine Orbs */
  divineValue: number | null;
  /** Источник данных */
  source: string;
  /** Обновлено (timestamp) */
  updatedAt: number;
}

/**
 * Одна точка тренда валюты (P1 #8, история цен).
 *
 * ВАЖНО (честно): poe.ninja PoE2 не отдаёт публичный history-эндпоинт с
 * абсолютными ценами по дням. Единственная «история», доступная в Exchange
 * Overview, — это sparkline: `totalChange` (изменение за окно, %) и `days` —
 * дневной ряд значений, который poe.ninja отдаёт как изменения, а не цены.
 * Поэтому тренд показываем именно так, с оговоркой про источник.
 */
export interface CurrencyHistoryPoint {
  id: string;
  name: string;
  category: string;
  /** Текущая цена в chaos-эквиваленте (по курсу exchange). */
  chaosValue: number | null;
  /** Изменение за окно (poe.ninja sparkline.totalChange), % или null. */
  totalChange: number | null;
  /** Дневной ряд, len = окно дней (poe.ninja sparkline.data). null — нет данных. */
  days: Array<number | null>;
}

export interface PriceCheckResult {
  /** Разобранное имя предмета */
  itemName: string;
  /** Тип редкости: unique/rare/style/gem/currency/other */
  rarity: string;
  /** Оценка цены */
  estimate: PriceEstimate | null;
  /** Список похожих объявлений с торгового сайта */
  listings: TradeListing[];
  /** Пояснение к оценке (fallback без аффиксов, low-доверие и т.п.). */
  note?: string;
  /** Источники */
  sources: string[];
  /** Лига, для которой выполнялся прайс-чек (или null, если активная не выбрана). */
  league?: string | null;
  /** Обновлено */
  updatedAt: number;
}

export interface PriceEstimate {
  min: number;
  max: number;
  median: number;
  /** Качество оценки: exact/approx/low/no-data (low — оценка по < 5 ценам) */
  confidence: 'exact' | 'approx' | 'low' | 'no-data';
}

export interface TradeListing {
  price: number;
  currency: string;
  /* Имя листинга (если доступно) */
  itemName?: string;
  /** №67: эквивалент в Chaos Orbs (курс poe2scout/poe.ninja); null/нет — курс неизвестен. */
  chaos?: number | null;
}

/**
 * Группа камней из билда PoB (<Skill>): активный камень + саппорты.
 * Знания о формате — docs/POB2_XML_REFERENCE.md (исследование PoB2).
 */
export interface BuildSkillGroup {
  /** Подпись группы (label) или слот-источник. */
  label: string;
  /** Группа включена (enabled="false" → выключена). */
  enabled: boolean;
  /** Происхождение группы: "Item:Weapon 1", "Tree:…", "Default Attack"… */
  source?: string;
  /** Главная группа сокетов билда (mainSocketGroup, 1-based). */
  main?: boolean;
  /** Гемы группы (name, level, quality). */
  gems: Array<{ name: string; level: number | null; quality: number | null }>;
}

/** Активные бафы/курсы из <Buffs> экспорта PoB (CSV имён). */
export interface BuildBuffs {
  buffList: string[];
  combatList: string[];
  curseList: string[];
}

export interface BuildImport {
  /** Декодированный код */
  source: string;
  class?: string;
  ascendancy?: string;
  level?: number;
  skills: string[];
  /** Распределённые узлы дерева пассивок */
  passiveNodes: string[];
  /** Версия дерева активного <Spec treeVersion="0_3"> (PoB2: "0_1".."0_5"; undefined, если не указана). */
  treeVersion?: string;
  gear: Record<string, string>;
  /** Ключевые расчётные характеристики PoB (TotalDPS, CombinedDPS, Life, ES, …), если в экспорте есть <PlayerStat>. */
  stats?: Record<string, number>;
  /** Группы камней с уровнями/качеством (<Skill>/<Gem>), активная помечена main. */
  skillGroups?: BuildSkillGroup[];
  /** Активные бафы/проклятия (<Buffs buffList/combatList/curseList>). */
  buffs?: BuildBuffs;
  /** Раскладка FullDPS по скиллам (<FullDPSSkill>). */
  fullDps?: Array<{ stat: string; value: number }>;
  /** Входы активного конфигура сета (<ConfigSet><Input>): enemyIsBoss, enemyLevel, … */
  config?: Record<string, string>;
  /** Заметки билда (<Notes>, первые 2000 символов). */
  notes?: string;
  raw?: unknown;
}

/** Слот снаряжения билда с полным клир-текстом предмета (из экспорта PoB). */
export interface BuildGearItem {
  /** Слот (Helm, BodyArmour, Gloves, …). Пусто, если неизвестен. */
  slot: string;
  /** Имя предмета. */
  name: string;
  /** Полный клир-текст предмета (парсится через parseItemText). */
  itemText: string;
}

/** Результат прайс-чека одного предмета снаряжения билда. */
export interface BuildPricedItem {
  slot: string;
  name: string;
  rarity: string;
  estimate: PriceEstimate | null;
  sources: string[];
  listingsCount: number;
  /** Пояснение, откуда взята оценка (fallback без аффиксов, low-доверие и т.п.). */
  note?: string;
}

/** Отчёт прайс-чека всего снаряжения билда. */
export interface BuildPriceReport {
  league: string | null;
  items: BuildPricedItem[];
  /**
   * Суммарная нижняя (консервативная) граница стоимости снаряжения в валюте лиги.
   * Считается по min оценок тех предметов, где цена известна.
   */
  totalMin: number;
  /** Суммарная верхняя граница (по max оценок оценённых предметов). */
  totalMax?: number;
  /** Суммарная медиана оценок. */
  totalMedian?: number;
  /** Валюта сумм (по умолчанию — chaos). */
  totalCurrency?: string;
  /** Число предметов, чью цену удалось оценить. */
  pricedCount: number;
  /** Общее число обработанных предметов снаряжения. */
  totalItems: number;
  /** Длительность (мс). */
  elapsedMs: number;
}

export interface LevelingZone {
  act: number;
  actName: string;
  zone: string;
  /** Рекомендуемый уровень монстров */
  monsterLevel: number;
  /** Есть ли в зоне вояпоинт (быстрый телепорт). undefined — неизвестно. */
  hasWaypoint?: boolean;
  /** Ключевые задачи/заметки */
  steps: string[];
  /** Квестовые награды: скил-пойнты, буст духа и т.п. */
  rewards: string[];
}

export interface AIProviderInfo {
  /** Идентификатор провайдера */
  id: string;
  /** Человеко-читаемое имя */
  label: string;
  /** Доступность в текущем окружении */
  available: boolean;
  /** Тип: local / opencode / external / none */
  kind: 'local' | 'opencode' | 'external' | 'none';
  /** Сообщение о статусе (ошибка и т.п.) */
  message?: string;
}

export interface AIRequest {
  prompt: string;
  /** Дополнительные данные об игроке (билд, предметы и т.п.) */
  context?: Record<string, unknown>;
}

export interface AIResponse {
  text: string;
  /** Какой провайдер сработал */
  provider: string;
  /** Откуда взят ответ: local / opencode */
  source: 'local' | 'opencode' | 'none';
}