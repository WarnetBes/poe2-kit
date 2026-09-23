/** Общие типы ядра PoE2 Kit */

export interface League {
  id: string;
  name: string;
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
  raw?: unknown;
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