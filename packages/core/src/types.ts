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

export interface PriceCheckResult {
  /** Разобранное имя предмета */
  itemName: string;
  /** Тип редкости: unique/rare/style/gem/currency/other */
  rarity: string;
  /** Оценка цены */
  estimate: PriceEstimate | null;
  /** Список похожих объявлений с торгового сайта */
  listings: TradeListing[];
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
  /** Качество оценки: exact/approx/no-data */
  confidence: 'exact' | 'approx' | 'no-data';
}

export interface TradeListing {
  price: number;
  currency: string;
  /* Имя листинга (если доступно) */
  itemName?: string;
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
  gear: Record<string, string>;
  /** Ключевые расчётные характеристики PoB (TotalDPS, CombinedDPS, Life, ES, …), если в экспорте есть <PlayerStat>. */
  stats?: Record<string, number>;
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
}

/** Отчёт прайс-чека всего снаряжения билда. */
export interface BuildPriceReport {
  league: string | null;
  items: BuildPricedItem[];
  /**
   * Суммарная нижняя (консервативная) граница стоимости снаряжения в валюте лиги.
   * Считается по median оценок тех предметов, где цена известна.
   */
  totalMin: number;
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