/**
 * ritualReferences.ts — №584 «Ritual-прайсинг», этапы 1–3: построение референсов
 * каталога и конвейер распознавания.
 *
 * Порт Recognizer.cs (донор: github.com/saxe78/poe2pricer, MIT © 2026 saxe78;
 * core — адаптация github.com/Dev-Jahn/poe2-ritual-checker, MIT © 2026 7c16291):
 *  - ctor / AddOfficialReferences / AddPadded / AddLearnedReferences (Recognizer.cs:53-185)
 *  - Premultiplied / AlphaMask / ExampleMask / CornerOfOneCell (Recognizer.cs:142-185)
 *  - Recognize / Propose (Recognizer.cs:187-288)
 *  - WarpAffine-варианты omens/currency (Recognizer.cs:85-95, Tuning.cs донора)
 *  - Anchor.Load (Anchor.cs:32-36)
 *
 * Референсы тяжёлые (~1300 PNG): строятся один раз и кэшируются (донор — в ctor).
 * Parallel.For донора (:214) — здесь последовательный проход: JS однопоточный,
 * бюджет одного скана по хоткею. Не портировано (Recognizer.cs:298-311
 * CellUnderMouse): MVP не следит за мышью; OCR/defer/embeddings опущены самим
 * донором (Recognizer.cs:1-5).
 */

import { decodePng } from './png.js';
import { HAS_DISK, fsMod } from './nodeenv.js';
import { FAVOURS_GRID, FAVOURS_TUNING, RECOGNITION_TUNING, getOfficialReferences, getRecognitionModel, getRitualCatalog, ritualAssetPath, type RitualCatalogItem } from './ritual.js';
import {
  Tune,
  boxWithin,
  cellOccupiedPixels,
  colorPixels,
  descriptorScore,
  describe,
  favoursCellBox,
  grayOfView,
  regionPartitionerSelect,
  resizeAreaBgr,
  resizeLinearGray,
  roiView,
  type BgraFrame,
  type Box,
  type FavoursGrid,
  type GrayImage,
  type RegionCandidate,
  type RoiView,
} from './ritualVision.js';

const Columns = FAVOURS_GRID.columns;
const Rows = FAVOURS_GRID.rows;

// ─── Референс ────────────────────────────────────────────────────────────────

export interface RitualReference {
  item: RitualCatalogItem;
  gray: ArrayLike<number>;
  edge: ArrayLike<number>;
  mask: Float32Array;
  color: ArrayLike<number>;
  minimumScore: number;
  trained: boolean;
}

// ─── Якорь окна (Anchor.Load, Anchor.cs:32-36) ───────────────────────────────

let anchorCache: GrayImage | null = null;

/** Якорь favours-tribute-bar.png в grayscale (ImreadModes.Grayscale донора). */
export function loadRitualAnchor(): GrayImage {
  if (!anchorCache) {
    if (!HAS_DISK) throw new Error('ritual: якорь доступен только под Node');
    const img = decodePng(fsMod!.readFileSync(ritualAssetPath(`ui/${FAVOURS_TUNING.anchorFile}`)));
    anchorCache = grayFromRgba(img);
  }
  return anchorCache;
}

/** RGBA→gray (формула RGB→GRAY; альфу игнорируем — как ImreadModes.Grayscale). */
function grayFromRgba(img: { width: number; height: number; data: Uint8Array }): GrayImage {
  const g = new Uint8Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) {
    const r = img.data[i * 4],
      gr = img.data[i * 4 + 1],
      b = img.data[i * 4 + 2];
    g[i] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * gr + 0.114 * b)));
  }
  return { width: img.width, height: img.height, data: g };
}

// ─── Построение референсов каталога (Recognizer.cs:53-185) ──────────────────

/** Пиксельные planes: premultiplied BGR + alpha, размеры исходника. */
interface Planes {
  width: number;
  height: number;
  b: Uint8Array;
  g: Uint8Array;
  r: Uint8Array;
  a: Uint8Array;
}

let refsCache: RitualReference[] | null = null;

/**
 * Все референсы: official-арт каталога (варианты omens/currency, паддинги
 * Foci/Weapons) + learned-прототипы. Донор: Recognizer ctor, throw при пустом
 * наборе (Recognizer.cs:53-69).
 */
export function buildRitualReferences(useLearned = true): RitualReference[] {
  if (!refsCache) {
    if (!HAS_DISK) throw new Error('ritual: референсы доступны только под Node');
    const refs: RitualReference[] = [];
    const catalog = getRitualCatalog();
    const official = new Map<string, string>(
      (getOfficialReferences().items as { catalogId: string; image: string }[]).map((i) => [i.catalogId, i.image]),
    );
    for (const item of catalog.items) addOfficialReferences(refs, item, official);
    if (useLearned) addLearnedReferences(refs);
    if (refs.length === 0) throw new Error('ritual: нет ни одного reference-изображения');
    refsCache = refs;
  }
  return refsCache;
}

/** Только для тестов: сброс кэша референсов/якоря. */
export function resetRitualCaches(): void {
  refsCache = null;
  anchorCache = null;
}

/** AddOfficialReferences (Recognizer.cs:71-109). */
function addOfficialReferences(refs: RitualReference[], item: RitualCatalogItem, official: Map<string, string>): void {
  const imageRel = official.get(item.id) ?? item.image;
  let img;
  try {
    img = decodePng(fsMod!.readFileSync(ritualAssetPath(`catalog/${imageRel}`)));
  } catch {
    return; // donor: пустой Mat → skip (Recognizer.cs:77)
  }
  if (img.width === 0 || img.height === 0 || img.colorType !== 6 || item.width > 2 || item.height > 4) return;

  const variants =
    item.id.startsWith('Omen_') && official.has(item.id)
      ? OmenVariants
      : item.kind === 'currency' && item.width === 1 && item.height === 1
        ? CurrencyVariants
        : IdentityVariant;

  for (const [scale, shift, shiftY] of variants) {
    const warped = warpAffine(img, scale, shift, shiftY);
    const planes = premultiplied(warped);
    const view = planesView(planes);
    const d = describe(view);
    refs.push({
      item,
      gray: d.gray,
      edge: d.edge,
      mask: alphaMask(planes, item),
      color: colorPixels(resizeAreaBgr(view, 24, 48)),
      minimumScore: 0,
      trained: false,
    });
    // Foci are drawn one cell taller in the Ritual grid (Recognizer.cs:101-103).
    if (item.kind === 'unique' && item.width === 2 && item.height === 2 && (item.imageSource ?? '').includes('/Foci/'))
      addPadded(refs, planes, { ...item, height: 3 }, 0, Math.trunc(planes.height / 4), planes.width, Math.trunc((planes.height * 3) / 2));
    // Some one-cell-wide weapons occupy a two-cell-wide slot (Recognizer.cs:104-106).
    if (item.kind === 'unique' && item.width === 1 && item.height >= 3 && (item.imageSource ?? '').includes('/Weapons/'))
      addPadded(refs, planes, { ...item, width: 2 }, Math.trunc(planes.width / 2), 0, planes.width * 2, planes.height);
  }
}

/** Tuning.Recognition OmenVariants/CurrencyVariants (Tuning.cs донора). */
const OmenVariants: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.0, 0.0],
  [0.96, -0.025, 0.0],
  [0.96, -0.025, -0.025],
  [0.78, 0.0, 0.0],
];
const CurrencyVariants: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.0, 0.0],
  [0.78, 0.0, 0.0],
];
const IdentityVariant: ReadonlyArray<readonly [number, number, number]> = [[1.0, 0.0, 0.0]];

/** WarpAffine Linear + border 0 (Recognizer.cs:87-95): dst(x,y)=src(scale·x+tx, scale·y+ty). */
function warpAffine(img: { width: number; height: number; data: Uint8Array }, scale: number, shift: number, shiftY: number): { width: number; height: number; data: Uint8Array } {
  const w = img.width,
    h = img.height;
  const out = new Uint8Array(w * h * 4);
  const tx = w * ((1 - scale) / 2 + shift),
    ty = h * ((1 - scale) / 2 + shiftY);
  const sample = (sx: number, sy: number, ch: number): number => {
    const x0 = Math.floor(sx),
      y0 = Math.floor(sy);
    const fx = sx - x0,
      fy = sy - y0;
    let s = 0;
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const xx = x0 + dx,
          yy = y0 + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) s += img.data[(yy * w + xx) * 4 + ch] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      }
    return s;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let ch = 0; ch < 4; ch++)
        out[(y * w + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round(sample(scale * x + tx, scale * y + ty, ch))));
  return { width: w, height: h, data: out };
}

/** Premultiplied (Recognizer.cs:142-156): BGR·alpha/255, byte-усечение (trunc). */
function premultiplied(img: { width: number; height: number; data: Uint8Array }): Planes {
  const n = img.width * img.height;
  const p: Planes = { width: img.width, height: img.height, b: new Uint8Array(n), g: new Uint8Array(n), r: new Uint8Array(n), a: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    const opacity = img.data[i * 4 + 3] / 255;
    p.b[i] = Math.trunc(img.data[i * 4 + 2] * opacity);
    p.g[i] = Math.trunc(img.data[i * 4 + 1] * opacity);
    p.r[i] = Math.trunc(img.data[i * 4 + 0] * opacity);
    p.a[i] = img.data[i * 4 + 3];
  }
  return p;
}

function planesView(p: Planes): RoiView {
  return {
    width: p.width,
    height: p.height,
    at(x, y, out) {
      const i = y * p.width + x;
      out.b = p.b[i];
      out.g = p.g[i];
      out.r = p.r[i];
    },
  };
}

/** CornerOfOneCell (Recognizer.cs:160-161): углы стека/медальона 1×1 не сравниваются. */
function cornerOfOneCell(item: RitualCatalogItem, x: number, y: number): boolean {
  return item.width === 1 && item.height === 1 && ((x < 8 && y < 15) || (x > 15 && y > 31));
}

/** AlphaMask (Recognizer.cs:163-175): bilinear-resize alpha → 24×48 маска. */
function alphaMask(planes: Planes, item: RitualCatalogItem): Float32Array {
  const resized = resizeLinearGray(planes.a, planes.width, planes.height, 24, 48);
  const mask = new Float32Array(1152);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 24; x++)
      mask[y * 24 + x] =
        resized[y * 24 + x] > Tune.alphaVisible && x > 1 && x < 22 && y > 1 && y < 46 && !cornerOfOneCell(item, x, y)
          ? resized[y * 24 + x] / 255
          : 0;
  return mask;
}

/** ExampleMask (Recognizer.cs:177-185): маска learned-прототипа. */
function exampleMask(item: RitualCatalogItem): Float32Array {
  const mask = new Float32Array(1152);
  for (let y = 3; y < 45; y++)
    for (let x = 2; x < 22; x++) if (!cornerOfOneCell(item, x, y)) mask[y * 24 + x] = 1;
  return mask;
}

/** AddPadded (Recognizer.cs:111-127): предмет, вписанный в бóльший слот. */
function addPadded(refs: RitualReference[], planes: Planes, item: RitualCatalogItem, dx: number, dy: number, width: number, height: number): void {
  const b = new Uint8Array(width * height),
    g = new Uint8Array(width * height),
    r = new Uint8Array(width * height),
    a = new Uint8Array(width * height);
  for (let y = 0; y < planes.height && y + dy < height; y++)
    for (let x = 0; x < planes.width && x + dx < width; x++) {
      const src = y * planes.width + x,
        dst = (y + dy) * width + x + dx;
      b[dst] = planes.b[src];
      g[dst] = planes.g[src];
      r[dst] = planes.r[src];
      a[dst] = planes.a[src];
    }
  const padded: Planes = { width, height, b, g, r, a };
  const view = planesView(padded);
  const d = describe(view);
  const small = resizeLinearGray(a, width, height, 24, 48);
  const mask = new Float32Array(1152);
  for (let y = 2; y < 46; y++)
    for (let x = 2; x < 22; x++) mask[y * 24 + x] = small[y * 24 + x] > Tune.alphaVisible ? small[y * 24 + x] / 255 : 0;
  refs.push({
    item,
    gray: d.gray,
    edge: d.edge,
    mask,
    color: colorPixels(resizeAreaBgr(view, 24, 48)),
    minimumScore: 0,
    trained: false,
  });
}

/** AddLearnedReferences (Recognizer.cs:129-140): ModelMismatch → throw. */
function addLearnedReferences(refs: RitualReference[]): void {
  const model = getRecognitionModel();
  const catalog = getRitualCatalog();
  if (model.schemaVersion !== 1 || model.catalogVersion !== catalog.version)
    throw new Error('ritual: ModelMismatch (recognition-model.json не под эту версию каталога)');
  for (const p of model.prototypes) {
    const item = catalog.items.find((i) => i.id === p.catalogId);
    if (!item) continue;
    const sized: RitualCatalogItem = { ...item, width: p.columns, height: p.rows };
    refs.push({
      item: sized,
      gray: p.gray,
      edge: p.edge,
      mask: exampleMask(sized),
      color: p.color,
      minimumScore: Tune.learnedMinimumScore,
      trained: true,
    });
  }
}

// ─── Конвейер Recognize (Recognizer.cs:187-288) ──────────────────────────────

export interface RitualCandidate {
  id: string;
  nameEn: string;
  score: number;
}

export interface RitualItemMatch {
  column: number;
  row: number;
  width: number;
  height: number;
  box: Box;
  id: string;
  nameEn: string;
  score: number;
  doubtful: boolean;
  candidates: RitualCandidate[];
}

export interface RitualRecognition {
  grid: FavoursGrid;
  items: RitualItemMatch[];
  unassigned: number;
  durationMs: number;
}

interface Proposal {
  x: number;
  y: number;
  w: number;
  h: number;
  candidates: RitualCandidate[];
  score: number;
}

/** Recognize (Recognizer.cs:187-254). frame = reference-картинка (высота 1440). */
export function recognizeFavours(frame: BgraFrame, grid: FavoursGrid, refs?: RitualReference[]): RitualRecognition {
  const t0 = Date.now();
  const references = refs ?? buildRitualReferences();
  const occupied: boolean[][] = [];
  for (let y = 0; y < Rows; y++) {
    occupied.push(new Array(Columns).fill(false));
    for (let x = 0; x < Columns; x++) {
      const box = favoursCellBox(grid, x, y, 1, 1);
      if (!boxWithin(box, frame)) continue;
      occupied[y][x] = cellOccupiedPixels(frame, box, grid.cellSize);
    }
  }

  const groups = new Map<string, { w: number; h: number; refs: RitualReference[] }>();
  for (const r of references) {
    const key = `${r.item.width}x${r.item.height}`;
    const g = groups.get(key);
    if (g) g.refs.push(r);
    else groups.set(key, { w: r.item.width, h: r.item.height, refs: [r] });
  }
  const work: { x: number; y: number; group: { w: number; h: number; refs: RitualReference[] } }[] = [];
  for (let y = 0; y < Rows; y++)
    for (let x = 0; x < Columns; x++)
      if (occupied[y][x])
        for (const group of groups.values())
          if (x + group.w <= Columns && y + group.h <= Rows && allOccupied(occupied, x, y, group.w, group.h))
            work.push({ x, y, group });

  const proposals: Proposal[] = [];
  for (const wk of work) {
    const p = propose(frame, grid, wk.x, wk.y, wk.group.w, wk.group.h, wk.group.refs);
    if (p) proposals.push(p);
  }

  const used: boolean[][] = Array.from({ length: Rows }, () => new Array(Columns).fill(false));
  const items: RitualItemMatch[] = [];
  const candidates: RegionCandidate[] = proposals.map((p, i) => ({ x: p.x, y: p.y, width: p.w, height: p.h, score: p.score, index: i }));
  const partition = regionPartitionerSelect(candidates, Columns, Rows);
  const byId = new Map(getRitualCatalog().items.map((it) => [it.id, it]));
  for (const index of partition) {
    const p = proposals[index];
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) used[p.y + dy][p.x + dx] = true;
    const item = byId.get(p.candidates[0].id)!;
    const margin = p.candidates.length > 1 ? p.score - p.candidates[1].score : 1;
    items.push({
      column: p.x,
      row: p.y,
      width: p.w,
      height: p.h,
      box: favoursCellBox(grid, p.x, p.y, p.w, p.h),
      id: item.id,
      nameEn: item.nameEn,
      score: p.score,
      doubtful: p.score < Tune.minimumScore || margin < Tune.minimumMargin,
      candidates: p.candidates,
    });
  }
  let unassigned = 0;
  for (let y = 0; y < Rows; y++)
    for (let x = 0; x < Columns; x++) if (occupied[y][x] && !used[y][x]) unassigned++;
  items.sort((a, b) => a.row - b.row || a.column - b.column);
  return { grid, items, unassigned, durationMs: Date.now() - t0 };
}

function allOccupied(occupied: boolean[][], x: number, y: number, w: number, h: number): boolean {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (!occupied[y + dy][x + dx]) return false;
  return true;
}

/** Propose (Recognizer.cs:256-288). */
function propose(frame: BgraFrame, grid: FavoursGrid, x: number, y: number, w: number, h: number, refs: RitualReference[]): Proposal | null {
  const box = favoursCellBox(grid, x, y, w, h);
  const view = roiView(frame, box);
  const d: { gray: Float32Array; edge: Float32Array } = describe(view);
  const color = colorPixels(resizeAreaBgr(view, 24, 48));
  const scored = refs.map((r) => ({ reference: r, score: descriptorScore(r, d.gray, d.edge, color) }));

  // Similar real prototypes are not independent evidence for a new winner (Recognizer.cs:264-273).
  const learnedById = new Map<string, number>();
  for (const s of scored)
    if (s.reference.trained && s.score > (learnedById.get(s.reference.item.id) ?? -Infinity)) learnedById.set(s.reference.item.id, s.score);
  const learned = [...learnedById.values()].sort((a, b) => b - a).slice(0, 2);
  const learnedReliable =
    learned.length > 0 && learned[0] >= Tune.learnedMinimumScore && (learned.length === 1 || learned[0] - learned[1] >= Tune.learnedMinimumLead);

  const byId = new Map<string, RitualCandidate>();
  for (const s of scored) {
    if (s.score <= 0 || (s.reference.trained && !learnedReliable)) continue;
    const old = byId.get(s.reference.item.id);
    if (!old || s.score > old.score)
      byId.set(s.reference.item.id, { id: s.reference.item.id, nameEn: s.reference.item.nameEn, score: s.score });
  }
  const candidates = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  if (candidates.length === 0) return null;
  const lead = candidates[0].score - (candidates.length > 1 ? candidates[1].score : 0);
  return w * h === 1 || (candidates[0].score >= Tune.minimumMultiCellScore && lead >= Tune.minimumMultiCellMargin)
    ? { x, y, w, h, candidates, score: candidates[0].score }
    : null;
}

// ─── Утилита скана (CellOccupied, Recognizer.cs:291-295 — для CellMemory) ─────

/** Занята ли ячейка (одноклеточный предикат донора). */
export function favoursCellOccupied(frame: BgraFrame, grid: FavoursGrid, column: number, row: number): boolean {
  const box = favoursCellBox(grid, column, row, 1, 1);
  return boxWithin(box, frame) && cellOccupiedPixels(frame, box, grid.cellSize);
}

// ─── Место ценника (наша интерпретация FAVOURS_TUNING.labelSpot*, донор: CellMemory.Look(spot)) ──

/** Прямоугольник 56×28 у центра нижней кромки предмета — место, где сравнивается фон ценника. */
export function ritualLabelSpot(box: Box): Box {
  const cx = box.x + box.width / 2;
  return {
    x: Math.round(cx - FAVOURS_TUNING.labelSpotWidth / 2),
    y: box.y + box.height - FAVOURS_TUNING.labelSpotHeight,
    width: FAVOURS_TUNING.labelSpotWidth,
    height: FAVOURS_TUNING.labelSpotHeight,
  };
}
