/**
 * №584 «Ritual-прайсинг»: офлайн-данные распознавания окна Ritual (Favours).
 *
 * Донор: github.com/saxe78/poe2pricer (MIT © 2026 saxe78), ядро распознавания —
 * адаптация github.com/Dev-Jahn/poe2-ritual-checker (MIT © 2026, commit 7c16291);
 * каталог и картинки — материал GGG (через poe2db.tw / web.poecdn.com), НЕ покрывается
 * MIT — см. THIRD_PARTY_NOTICES. Константы портированы из src/Poe2Pricer.Core/Tuning.cs
 * дословно (калиброваны на окнах 1080–2160, reference-высота 1440).
 *
 * Данные в packages/core/data/game/ritual/:
 *  - catalog/catalog.json           — 956 предметов (445 unique + 511 currency)
 *  - catalog/recognition-model.json — learned-прототипы (24×48: gray/edge/color)
 *  - catalog/official-references.json — эталоны official-арта (439)
 *  - catalog/images/, official-images/ — иконки предметов
 *  - ui/favours-tribute-bar.png     — якорь окна Ritual (левый конец рамки tribute-бара)
 *  - ui/*.png                       — якоря/арт тултипов, стэша, рамок слухов
 *  - rumours/en-lines.json          — ink-подписи rumour-строк (вне MVP)
 *
 * Распознавание (этап 2) — чистая математика поверх этих данных: демо Node-only
 * (Electron overlay main), браузерные копии не устанавливаются.
 */

import { HAS_DISK, fsMod, pathMod, urlMod } from './nodeenv.js';

// ─── Типы (структура = факт донора, catalog.json / recognition-model.json) ───

/** Предмет каталога Ritual (формат Dev-Jahn poe2-ritual-checker). */
export interface RitualCatalogItem {
  id: string;
  nameEn: string;
  nameKo?: string | null;
  kind: 'unique' | 'currency' | (string & {});
  /** Относительный путь внутри ritual/ (напр. "images/cdcecc4f...png"). */
  image: string;
  /** Занимает ячеек сетки. */
  width: number;
  height: number;
  source?: string;
  imageSource?: string;
  modsEn?: string[];
  maxStackSize?: number;
}

export interface RitualCatalog {
  version: string;
  retrievedAt: string;
  items: RitualCatalogItem[];
}

/** Learned-прототип ячейки: gray/edge 24×48, color-подпись. */
export interface RecognitionPrototype {
  catalogId: string;
  columns: number;
  rows: number;
  gray: number[];
  edge: number[];
  color: number[];
  sourceHash?: string;
}

export interface RecognitionModel {
  schemaVersion: number;
  catalogVersion: string;
  method: string;
  trainingEvidence: number;
  prototypes: RecognitionPrototype[];
}

export interface OfficialReferences {
  source: string;
  retrievedAt: string;
  catalogVersion: string;
  items: unknown[];
  errors: unknown[];
}

// ─── Константы Tuning.cs (дословный порт, №584 этап 0) ────────────────────────

/** Tuning.Recognition: пороги сравнения ячеек с референсами. */
export const RECOGNITION_TUNING = {
  /** Минимальный score одиночной ячейки. */
  minimumScore: 0.45,
  minimumMargin: 0.03,
  /** Мульти-ячеечные предметы: score/margin выше. */
  minimumMultiCellScore: 0.6,
  minimumMultiCellMargin: 0.1,
  /** Learned-прототипы строже каталога. */
  learnedMinimumScore: 0.82,
  learnedMinimumLead: 0.04,
  /** Сравнение = 0.70·gray-корреляция + 0.30·edge (Sobel)-корреляция − penalty. */
  grayWeight: 0.7,
  edgeWeight: 0.3,
  penaltyWeight: 0.45,
  penaltySaturation: 0.1,
  penaltyMinimumPixels: 12,
  darkSum: 100,
  noColour: 0.5,
  alphaVisible: 80,
  /** Обрезка ячейки: рамка не участвует в сравнении. */
  cellInsetX: 0.09,
  cellInsetY: 0.08,
  cellInner: 0.8,
  blueOverRed: 1.3,
  blueOverGreen: 1.15,
  redOverOthers: 1.3,
  colourLead: 4,
  blueOverGreenLead: 3,
  brightLevel: 65,
  blueShare: 0.14,
  redShare: 0.14,
  brightShare: 0.08,
  greenOverOthers: 1.3,
  greenShare: 0.14,
} as const;

/** Tuning.Screen: приведение разрешения к эталону 1440. */
export const SCREEN_TUNING = {
  referenceHeight: 1440,
  /** Масштаб считается тем же, если изменился менее чем на это. */
  sameScale: 0.02,
  /** Допуск по высоте окна при поиске кадра (px). */
  heightTolerance: 30,
  widestAspect: 2.4,
  /** Приведение нецелочисленного масштаба: шаги ≤64 px … */
  longestStep: 64,
  /** … с перекрытием 3 px между частями (кubic-соседи). */
  resizeMargin: 3,
} as const;

/** Tuning.Favours: геометрия сетки Favours и память ячеек (CellMemory). */
export const FAVOURS_TUNING = {
  /** Ячейка сетки в reference-px. */
  cell: 70.18,
  /** Начало сетки по режиму UI: клавиатура 356 / контроллер 411 (px @1440);
   *  dx/dy — смещение якоря от origin сетки. */
  gridTop: {
    keyboard: { top: 356, dx: 30, dy: 705 },
    controller: { top: 411, dx: 31, dy: 706 },
  } as const,
  /** Якорь: левый конец рамки tribute-бара под сеткой, ищется по строке ±16 px. */
  anchorFile: 'favours-tribute-bar.png',
  searchRadius: 16,
  minimumAnchorScore: 0.7,
  /** Кнопка ролла левее tribute-бара (относительно origin сетки). */
  rerollLeft: 62,
  rerollTop: -112,
  rerollWidth: 88,
  rerollHeight: 90,
  digitWhite: 200,
  digitBlack: 45,
  digitPixels: 8,
  digitOutline: 0.5,
  numberMargin: 3,
  /** CellMemory: сравнение ячейки с прошлым кадром (медиана отношений яркости). */
  darkPixel: 12,
  measurablePixels: 30,
  coveredBelow: 0.4,
  doubtfulBrighter: 1.5,
  /** Структура (gray-корреляция кадров) держится ≥0.80 → место unchanged. */
  sameStructure: 0.8,
  sameRollItems: 2,
  emptyDeviation: 6,
  stillThere: 0.25,
  windowDimmed: 0.9,
  dimmedBelow: 0.7,
  /** Место ценника: центр нижней кромки предмета, 56×28 px. */
  labelSpotWidth: 56,
  labelSpotHeight: 28,
  replacedBelow: 0.2,
  cellMoved: 1,
} as const;

/** Геометрия сетки Ritual: 12 колонок × 10 строк (CellMemory.cs:93-94 и Recognizer.cs:15-16). */
export const FAVOURS_GRID = { columns: 12, rows: 10 } as const;

/** Tuning.Selection: детект выбранной ячейки (жёлтая рамка). */
export const SELECTION_TUNING = {
  tipAbove: 14,
  threshold: 0.6,
  searchSide: 10,
  searchBelow: 20,
  matchVertical: 8,
  matchHorizontal: 10,
  minimumRed: 200,
  minimumGreen: 185,
} as const;

// ─── Загрузка (Node-only: Electron overlay main / MCP / тесты) ────────────────

function dataDir(): string {
  return pathMod!.join(pathMod!.dirname(urlMod!.fileURLToPath(import.meta.url)), '..', 'data', 'game', 'ritual');
}

let catalogCache: RitualCatalog | null = null;
let modelCache: RecognitionModel | null = null;
let officialCache: OfficialReferences | null = null;

function readJson<T>(rel: string): T {
  return JSON.parse(fsMod!.readFileSync(pathMod!.join(dataDir(), rel), 'utf8')) as T;
}

/** Каталог предметов Ritual (956: unique + currency). */
export function getRitualCatalog(): RitualCatalog {
  if (!HAS_DISK) throw new Error('ritual-датасет доступен только под Node (overlay main/MCP/тесты)');
  if (!catalogCache) catalogCache = readJson<RitualCatalog>('catalog/catalog.json');
  return catalogCache;
}

/** Learned-модель распознавания (прототипы 24×48). */
export function getRecognitionModel(): RecognitionModel {
  if (!HAS_DISK) throw new Error('ritual-датасет доступен только под Node (overlay main/MCP/тесты)');
  if (!modelCache) modelCache = readJson<RecognitionModel>('catalog/recognition-model.json');
  return modelCache;
}

/** Эталоны official-арта (для stash-этапа; включены сразу — дешёвые). */
export function getOfficialReferences(): OfficialReferences {
  if (!HAS_DISK) throw new Error('ritual-датасет доступен только под Node (overlay main/MCP/тесты)');
  if (!officialCache) officialCache = readJson<OfficialReferences>('catalog/official-references.json');
  return officialCache;
}

/** Абсолютный путь к файлу датасета (картинки/якоря для main-процесса). */
export function ritualAssetPath(rel: string): string {
  return pathMod!.join(dataDir(), rel);
}

/**
 * Статус ритуал-датасета. В portable-сборках каталог data/game/ritual вырезен
 * из base-zip и докачивается start-overlay.bat с релиза (лимит ассетов ~100 МБ
 * меньше несжимаемого датасета ~49 МБ + база). catalog.json — необходимый
 * файл датасета: нет его → ритуал нерабоч, считаем датасет отсутствующим.
 */
export function ritualDatasetStatus(opts?: { dataDirOverride?: string }): { ready: true } | { ready: false; reason: string } {
  if (!HAS_DISK) return { ready: false, reason: 'датасет ритуала доступен только в Node (overlay main/MCP/тесты)' };
  const dir = opts?.dataDirOverride ?? dataDir();
  if (!fsMod!.existsSync(pathMod!.join(dir, 'catalog', 'catalog.json'))) {
    return {
      ready: false,
      reason:
        'Датасет ритуала не найден. Запустите start-overlay.bat — при первом старте он скачает данные ' +
        '(~49 МБ, один раз, дальше офлайн). Если вы запускаете не из portable и видите это — ' +
        'выполните npm ci / восстановите packages/core/data/game/ritual из репозитория.',
    };
  }
  return { ready: true };
}

/** Карта catalogId → предмет (ленивая). */
let byIdCache: Map<string, RitualCatalogItem> | null = null;
export function ritualItemById(id: string): RitualCatalogItem | undefined {
  if (!byIdCache) {
    byIdCache = new Map(getRitualCatalog().items.map((it) => [it.id, it]));
  }
  return byIdCache.get(id);
}
