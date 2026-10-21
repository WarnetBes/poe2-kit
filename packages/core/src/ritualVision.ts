/**
 * ritualVision.ts — №584 «Ritual-прайсинг», этапы 1–3: математика распознавания.
 *
 * Донор: github.com/saxe78/poe2pricer (MIT © 2026 saxe78), ядро — адаптация
 * github.com/Dev-Jahn/poe2-ritual-checker (MIT © 2026 7c16291). Каждый блок
 * помечен источником (файл:строки донора).
 *
 * Замены OpenCV (донор — OpenCvSharp; численный дрейф score помечен ❓ —
 * обязательная живая калибровка на игровом ПК; у порогов донора есть запас:
 * якорь: попадания ≥.85, мимо ≤.53 при пороге .70):
 *  - INTER_AREA  → box-фильтр (среднее по прямоугольнику исходных пикселей;
 *    OpenCV дробит края окна fixed-point весами — у нас честный box);
 *  - Sobel 3×3   → точный порт (CV_32F, край = |gx|+|gy|, бордюр REFLECT_101);
 *  - INTER_LINEAR→ билинейный reshape (там, где у донора resize с default);
 *  - INTER_CUBIC → бикубик a=-0.75 (ядро OpenCV), center-aligned сэмпл;
 *  - MatchTemplate CCoeffNormed → NCC вручную: грубый проход (downscale ×3)
 *    + уточнение ±8 px полным NCC по трём лучшим грубым пикам (якорь ищется
 *    по всей ширине кадра, Anchor.cs:10).
 *
 * Раскладка пикселей всюду BGRA: byte0=B, byte1=G, byte2=R, byte3=A — как Mat
 * BGR донора; экран BitBlt/GetDIBits даёт BGRA; PNG приводится rgbaToBgra.
 * Не портировано (MVP): GameView.Part/LookArea — частичные чтения (перф-
 * оптимизация донора); MVP читает весь кадр один раз по хоткею.
 */

import { FAVOURS_GRID, FAVOURS_TUNING, RECOGNITION_TUNING, SCREEN_TUNING } from './ritual.js';

export const Tune = RECOGNITION_TUNING; // Tuning.Recognition
export const FTune = FAVOURS_TUNING; // Tuning.Favours
const Columns = FAVOURS_GRID.columns; // Recognizer.cs:15-16 / CellMemory.cs:93-94
const Rows = FAVOURS_GRID.rows;

// ─── Геометрия (Box/Rect донора) ─────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const boxRight = (b: Box): number => b.x + b.width;
export const boxBottom = (b: Box): number => b.y + b.height;

export function boxUnion(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(boxRight(a), boxRight(b)) - x, height: Math.max(boxBottom(a), boxBottom(b)) - y };
}

/** Rect.Intersect семантики OpenCV (в т.ч. с «границей» limit). */
export function boxIntersect(a: Box, limit: Box): Box {
  const x = Math.max(a.x, limit.x),
    y = Math.max(a.y, limit.y);
  const r = Math.min(boxRight(a), boxRight(limit)),
    b = Math.min(boxBottom(a), boxBottom(limit));
  return { x, y, width: Math.max(0, r - x), height: Math.max(0, b - y) };
}

// ─── Кадр: BGRA-буфер + Views (ROI с чёрным за границей) ─────────────────────

/** Экранный/эталонный кадр: BGRA, плоский массив width*height*4. */
export interface BgraFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Прямоугольник кадра, прочитанный с чёрным за пределами (Mat-ROI semantics). */
export interface RoiView {
  width: number;
  height: number;
  /** Читает пиксель ROI (x,y) в b,g,r (за границей кадра 0,0,0). */
  at(x: number, y: number, out: { b: number; g: number; r: number }): void;
}

export function frameView(frame: BgraFrame): RoiView {
  return {
    width: frame.width,
    height: frame.height,
    at(x, y, out) {
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
        out.b = out.g = out.r = 0;
        return;
      }
      const i = (y * frame.width + x) << 2;
      out.b = frame.data[i];
      out.g = frame.data[i + 1];
      out.r = frame.data[i + 2];
    },
  };
}

/** crop = new Mat(bgr, box): вне кадра — чёрное (GridPicture.cs:19-23). */
export function roiView(frame: BgraFrame, box: Box): RoiView {
  return {
    width: box.width,
    height: box.height,
    at(x, y, out) {
      const fx = box.x + x,
        fy = box.y + y;
      if (fx < 0 || fy < 0 || fx >= frame.width || fy >= frame.height) {
        out.b = out.g = out.r = 0;
        return;
      }
      const i = (fy * frame.width + fx) << 2;
      out.b = frame.data[i];
      out.g = frame.data[i + 1];
      out.r = frame.data[i + 2];
    },
  };
}

// ─── Resize: INTER_AREA (box-фильтр) / INTER_LINEAR / INTER_CUBIC ───────────

export interface BgrImage {
  width: number;
  height: number;
  b: Uint8Array;
  g: Uint8Array;
  r: Uint8Array;
}

/** Cv2.Resize(…, InterpolationFlags.Area): среднее покрываемых пикселей. */
export function resizeAreaBgr(view: RoiView, dw: number, dh: number): BgrImage {
  const b = new Uint8Array(dw * dh),
    g = new Uint8Array(dw * dh),
    r = new Uint8Array(dw * dh);
  const px = { b: 0, g: 0, r: 0 };
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * view.height) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * view.height) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * view.width) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * view.width) / dw));
      let sb = 0,
        sg = 0,
        sr = 0,
        n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          view.at(xx, yy, px);
          sb += px.b;
          sg += px.g;
          sr += px.r;
          n++;
        }
      const i = y * dw + x;
      b[i] = clamp255(Math.round(sb / n));
      g[i] = clamp255(Math.round(sg / n));
      r[i] = clamp255(Math.round(sr / n));
    }
  }
  return { width: dw, height: dh, b, g, r };
}

/** Cv2.Resize default (INTER_LINEAR) для однока»нальной 8U (alpha-маски). */
export function resizeLinearGray(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  const fx = sw / dw,
    fy = sh / dh;
  const sample = (sx: number, sy: number): number => {
    const x0 = Math.floor(sx),
      y0 = Math.floor(sy);
    const txb = sx - x0,
      tyb = sy - y0;
    let sum = 0;
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const xx = x0 + dx,
          yy = y0 + dy;
        // BORDER_CONSTANT 0 (borderMode по умолчанию у cv::resize): вне картинки значение 0.
        if (xx >= 0 && yy >= 0 && xx < sw && yy < sh)
          sum += src[yy * sw + xx] * (dx ? txb : 1 - txb) * (dy ? tyb : 1 - tyb);
      }
    return sum;
  };
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) out[y * dw + x] = clamp255(Math.round(sample((x + 0.5) * fx - 0.5, (y + 0.5) * fy - 0.5)));
  return out;
}

/** Cv2.Resize(…, InterpolationFlags.Cubic): ядро a=-0.75 (OpenCV), center-aligned. */
export function resizeCubicBgr(view: RoiView, dw: number, dh: number): BgrImage {
  const n = dw * dh;
  const b = new Uint8Array(n),
    g = new Uint8Array(n),
    r = new Uint8Array(n);
  const fx = view.width / dw,
    fy = view.height / dh;
  const px = { b: 0, g: 0, r: 0 };
  const W = (t: number): number => {
    const a = -0.75,
      at = Math.abs(t);
    if (at <= 1) return (a + 2) * at * at * at - (a + 3) * at * at + 1;
    if (at < 2) return a * at * at * at - 5 * a * at * at + 8 * a * at - 4 * a;
    return 0;
  };
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * fy - 0.5,
      y0 = Math.floor(sy);
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * fx - 0.5,
        x0 = Math.floor(sx);
      let sb = 0,
        sg = 0,
        sr = 0;
      for (let j = -1; j <= 2; j++) {
        const wy = W(sy - (y0 + j));
        if (wy === 0) continue;
        for (let i = -1; i <= 2; i++) {
          const w = W(sx - (x0 + i)) * wy;
          if (w === 0) continue;
          view.at(x0 + i, y0 + j, px);
          sb += w * px.b;
          sg += w * px.g;
          sr += w * px.r;
        }
      }
      const k = y * dw + x;
      b[k] = clamp255(Math.round(sb));
      g[k] = clamp255(Math.round(sg));
      r[k] = clamp255(Math.round(sr));
    }
  }
  return { width: dw, height: dh, b, g, r };
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ─── Describe / Score / ColorPenalty (Recognizer.cs:352-448, 364-383, 410-448)

/** Пиксели цвета, нормированные на сумму каналов (ColorPixels, Recognizer.cs:410-428). */
export function colorPixels(img: BgrImage): number[] {
  const values = new Array<number>(img.width * img.height * 3).fill(0);
  for (let i = 0; i < img.width * img.height; i++) {
    const sum = img.b[i] + img.g[i] + img.r[i];
    if (sum < Tune.darkSum) continue;
    values[i * 3] = img.b[i] / sum;
    values[i * 3 + 1] = img.g[i] / sum;
    values[i * 3 + 2] = img.r[i] / sum;
  }
  return values;
}

/** gray из area-resize BGR каналов (порядок донора: resize → BGR2GRAY → Sobel). */
function bgrImageToGray(img: BgrImage): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    out[i] = clamp255(Math.round(0.299 * img.r[i] + 0.587 * img.g[i] + 0.114 * img.b[i]));
  return out;
}

/** Sobel 3×3, CV_32F, бордюр REFLECT_101; возвращает {gx,gy} по каналу gray. */
function sobelXy(gray: Uint8Array, w: number, h: number): { gx: Float32Array; gy: Float32Array } {
  const at = (x: number, y: number): number => {
    // BORDER_REFLECT_101
    if (x < 0) x = -x;
    if (y < 0) y = -y;
    if (x >= w) x = 2 * w - 2 - x >= 0 ? 2 * w - 2 - x : w - 1;
    if (y >= h) y = 2 * h - 2 - y >= 0 ? 2 * h - 2 - y : h - 1;
    return gray[y * w + x];
  };
  const gx = new Float32Array(w * h),
    gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      gx[i] =
        -at(x - 1, y - 1) + at(x + 1, y - 1) +
        -2 * at(x - 1, y) + 2 * at(x + 1, y) +
        -at(x - 1, y + 1) + at(x + 1, y + 1);
      gy[i] =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
    }
  return { gx, gy };
}

export interface Descriptor {
  /** 24×48 gray (0–255). */
  gray: Float32Array;
  /** 24×48 edge = |gx|+|gy| (Sobel CV_32F). */
  edge: Float32Array;
}

/** Describe (Recognizer.cs:364-383): area-resize → gray → Sobel; 24×48=1152. */
export function describe(view: RoiView): Descriptor {
  const resized = resizeAreaBgr(view, 24, 48);
  const gray = bgrImageToGray(resized);
  const { gx, gy } = sobelXy(gray, 24, 48);
  const g = new Float32Array(1152),
    e = new Float32Array(1152);
  for (let i = 0; i < 1152; i++) {
    g[i] = gray[i];
    e[i] = Math.abs(gx[i]) + Math.abs(gy[i]);
  }
  return { gray: g, edge: e };
}

/** Correlation (Recognizer.cs:385-408): masked Pearson. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>, mask: ArrayLike<number>): number {
  let n = 0,
    sa = 0,
    sb = 0,
    aa = 0,
    bb = 0,
    ab = 0;
  for (let i = 0; i < a.length; i++) {
    const m = mask[i];
    if (m === 0) continue;
    const ai = a[i],
      bi = b[i];
    n += m;
    sa += ai * m;
    sb += bi * m;
    aa += ai * ai * m;
    bb += bi * bi * m;
    ab += ai * bi * m;
  }
  if (n < 8) return -1;
  return (ab - (sa * sb) / n) / Math.sqrt(Math.max(1, (aa - (sa * sa) / n) * (bb - (sb * sb) / n)));
}

/** ColorPenalty (Recognizer.cs:430-448). */
export function colorPenalty(a: ArrayLike<number>, b: ArrayLike<number>, mask: ArrayLike<number>): number {
  let distance = 0,
    n = 0,
    saturation = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const j = i * 3;
    if (a[j] + a[j + 1] + a[j + 2] < Tune.noColour || b[j] + b[j + 1] + b[j + 2] < Tune.noColour) continue;
    saturation += Math.max(a[j], a[j + 1], a[j + 2]) - Math.min(a[j], a[j + 1], a[j + 2]);
    distance += Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2]);
    n++;
  }
  // Grayscale items keep their shape score; coloured variants get a hue tie-break.
  return n > Tune.penaltyMinimumPixels && saturation / n > Tune.penaltySaturation ? (Tune.penaltyWeight * distance) / n : 0;
}

/** Score (Recognizer.cs:352-359): 0.70·gray + 0.30·edge − penalty. */
export function descriptorScore(ref: { gray: ArrayLike<number>; edge: ArrayLike<number>; color: ArrayLike<number>; mask: ArrayLike<number>; minimumScore: number }, gray: ArrayLike<number>, edge: ArrayLike<number>, color: ArrayLike<number>): number {
  const score =
    Tune.grayWeight * correlation(gray, ref.gray, ref.mask) +
    Tune.edgeWeight * correlation(edge, ref.edge, ref.mask) -
    colorPenalty(color, ref.color, ref.mask);
  return ref.minimumScore > 0 && score < ref.minimumScore ? -1 : score;
}

// ─── ItemGround / Occupied (ItemGround.cs:9-18, Recognizer.cs:323-350) ───────

export interface Bgr {
  b: number;
  g: number;
  r: number;
}

/** Предикаты фона ячейки; аргумент в BGR-порядке (Item0=B — ItemGround.cs:11-15). */
export const ItemGround = {
  blue: (p: Bgr) => p.b > p.r * Tune.blueOverRed + Tune.colourLead && p.b > p.g * Tune.blueOverGreen + Tune.blueOverGreenLead,
  red: (p: Bgr) => p.r > p.b * Tune.redOverOthers + Tune.colourLead && p.r > p.g * Tune.redOverOthers + Tune.colourLead,
  green: (p: Bgr) => p.g > p.b * Tune.greenOverOthers + Tune.colourLead && p.g > p.r * Tune.greenOverOthers + Tune.colourLead,
  any: (p: Bgr) => ItemGround.blue(p) || ItemGround.red(p) || ItemGround.green(p),
} as const;

/** Inner (Recognizer.cs:323-324): внутренняя площадь ячейки. */
export function cellInner(box: Box, c: number): Box {
  return {
    x: box.x + Math.trunc(c * Tune.cellInsetX),
    y: box.y + Math.trunc(c * Tune.cellInsetY),
    width: Math.max(4, Math.trunc(c * Tune.cellInner)),
    height: Math.max(4, Math.trunc(c * Tune.cellInner)),
  };
}

/** Occupied (Recognizer.cs:328-350): сэмпл каждые 2 px, доли синего/красного/зелёного/яркого. */
export function cellOccupiedPixels(frame: BgraFrame, box: Box, c: number): boolean {
  const inner = cellInner(box, c);
  let blue = 0,
    bright = 0,
    red = 0,
    green = 0;
  const p = { b: 0, g: 0, r: 0 };
  for (let cy = 0; cy < inner.height; cy += 2)
    for (let cx = 0; cx < inner.width; cx += 2) {
      const fx = inner.x + cx,
        fy = inner.y + cy;
      if (fx < 0 || fy < 0 || fx >= frame.width || fy >= frame.height) continue;
      const i = (fy * frame.width + fx) << 2;
      p.b = frame.data[i];
      p.g = frame.data[i + 1];
      p.r = frame.data[i + 2];
      if (ItemGround.blue(p)) blue++;
      if (ItemGround.red(p)) red++;
      if (ItemGround.green(p)) green++;
      if (Math.max(p.b, Math.max(p.g, p.r)) > Tune.brightLevel) bright++;
    }
  const n = Math.ceil(inner.height / 2) * Math.ceil(inner.width / 2);
  if (n <= 0) return false;
  return (
    blue / n > Tune.blueShare || red / n > Tune.redShare || green / n > Tune.greenShare || bright / n > Tune.brightShare
  );
}

/** Within (Recognizer.cs:361-362). */
export function boxWithin(box: Box, frame: BgraFrame): boolean {
  return (
    box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
    boxRight(box) <= frame.width && boxBottom(box) <= frame.height
  );
}

// ─── Anchor: NCC-поиск (Anchor.cs:16-37) ─────────────────────────────────────

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** BGR→gray для View (CvtColor BGR2GRAY). */
export function grayOfView(view: RoiView): GrayImage {
  const g = new Uint8Array(view.width * view.height);
  const px = { b: 0, g: 0, r: 0 };
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      view.at(x, y, px);
      g[y * view.width + x] = clamp255(Math.round(0.299 * px.r + 0.587 * px.g + 0.114 * px.b));
    }
  return { width: view.width, height: view.height, data: g };
}

/** Box-filter downscale gray ×k (для грубого прохода NCC). */
function downscaleGray(img: GrayImage, k: number): GrayImage {
  const dw = Math.floor(img.width / k),
    dh = Math.floor(img.height / k);
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (let yy = 0; yy < k; yy++)
        for (let xx = 0; xx < k; xx++) s += img.data[(y * k + yy) * img.width + (x * k + xx)];
      out[y * dw + x] = clamp255(Math.round(s / (k * k)));
    }
  return { width: dw, height: dh, data: out };
}

/** Наивный NCC (CCoeffNormed) в окне [x0..x1)×[y0..y1): {score,x,y} | null. */
export function nccBest(band: GrayImage, tpl: GrayImage, x0 = 0, y0 = 0, x1 = band.width, y1 = band.height): { score: number; x: number; y: number } | null {
  const pw = band.width - tpl.width + 1,
    ph = band.height - tpl.height + 1;
  if (pw <= 0 || ph <= 0) return null;
  const X0 = Math.max(0, x0),
    Y0 = Math.max(0, y0),
    X1 = Math.min(pw, x1),
    Y1 = Math.min(ph, y1);
  if (X1 <= X0 || Y1 <= Y0) return null;
  // Кумулятивные суммы полосы: NCC через скользящие суммы по окну шаблона.
  const W = band.width,
    H = band.height;
  const sum1 = new Float64Array((W + 1) * (H + 1));
  const sum2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++)
    for (let x = 1; x <= W; x++) {
      const v = band.data[(y - 1) * W + (x - 1)];
      sum1[y * (W + 1) + x] = v + sum1[(y - 1) * (W + 1) + x] + sum1[y * (W + 1) + (x - 1)] - sum1[(y - 1) * (W + 1) + (x - 1)];
      sum2[y * (W + 1) + x] = v * v + sum2[(y - 1) * (W + 1) + x] + sum2[y * (W + 1) + (x - 1)] - sum2[(y - 1) * (W + 1) + (x - 1)];
    }
  const area = (s: Float64Array, x: number, y: number, w: number, h: number): number =>
    s[(y + h) * (W + 1) + (x + w)] - s[y * (W + 1) + (x + w)] - s[(y + h) * (W + 1) + x] + s[y * (W + 1) + x];

  let tSum = 0,
    tSq = 0;
  const tw = tpl.width,
    th = tpl.height,
    tn = tw * th;
  for (let i = 0; i < tn; i++) {
    tSum += tpl.data[i];
    tSq += tpl.data[i] * tpl.data[i];
  }
  let best = -Infinity,
    bx = 0,
    by = 0;
  for (let y = Y0; y < Y1; y++)
    for (let x = X0; x < X1; x++) {
      const s = area(sum1, x, y, tw, th),
        sq = area(sum2, x, y, tw, th);
      const varB = sq - (s * s) / tn;
      const varT = tSq - (tSum * tSum) / tn;
      if (varB <= 0 || varT <= 0) continue;
      let ab = 0;
      for (let ty = 0; ty < th; ty++) {
        const rowB = y * W + x,
          rowT = ty * tw;
        for (let tx = 0; tx < tw; tx++) ab += band.data[rowB + ty * W + tx] * tpl.data[rowT + tx];
      }
      const c = (ab - (s * tSum) / tn) / Math.sqrt(varB * varT);
      if (c > best) {
        best = c;
        bx = x;
        by = y;
      }
    }
  return best === -Infinity ? null : { score: best, x: bx, y: by };
}

/**
 * Anchor.InRow (Anchor.cs:18-30): лучший шаблон с верхом на y±radius, по всей
 * ширине. Реализация: грубый проход ×3 + полный NCC в ±8 от трёх лучших грубых
 * пиков (замена Cv2.MatchTemplate CCoeffNormed; точность проверяется тестом
 * на реальном якоре).
 */
export function anchorInRow(frame: BgraFrame, template: GrayImage, y: number, radius: number): { score: number; x: number; y: number } | null {
  const band = boxIntersect({ x: 0, y: y - radius, width: frame.width, height: template.height + 2 * radius }, {
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height,
  });
  if (band.height < template.height || band.width < template.width) return null;
  const gray = grayOfView(roiView(frame, band));
  const k = Math.max(1, Math.floor(template.height / 24)); // 95 → 3
  const coarse = k === 1 ? nccBest(gray, template) : bestCoarse(gray, template, k);
  if (!coarse) return null;
  // coarse.y уже приведён к full-res; окно уточнения ±11 позиций вокруг него.
  const refined = nccBest(
    gray,
    template,
    coarse.x - 11,
    coarse.y - 11,
    coarse.x + 12,
    coarse.y + 12,
  );
  const best = refined ?? coarse;
  return { score: best.score, x: best.x, y: best.y + band.y };
}

function bestCoarse(gray: GrayImage, template: GrayImage, k: number): { score: number; x: number; y: number } | null {
  const coarseBand = downscaleGray(gray, k);
  const coarseTpl = downscaleGray(template, k);
  const found = nccBest(coarseBand, coarseTpl);
  return found ? { score: found.score, x: found.x * k, y: found.y * k } : null;
}

// ─── FavoursLocator (FavoursLocator.cs:18-57) ────────────────────────────────

export type UiMode = 'keyboard' | 'controller';

export interface FavoursGrid {
  mode: UiMode;
  bounds: Box;
  cellSize: number;
  anchorScore: number;
}

/** Locate (FavoursLocator.cs:18-35): лучший из двух режимов UI. */
export function locateFavoursGrid(frame: BgraFrame, anchor: GrayImage): FavoursGrid | null {
  let best: FavoursGrid | null = null;
  for (const mode of ['keyboard', 'controller'] as const) {
    const g = FTune.gridTop[mode];
    const found = anchorInRow(frame, anchor, g.top + g.dy, FTune.searchRadius);
    if (!found) continue;
    if (found.score < FTune.minimumAnchorScore || found.score <= (best?.anchorScore ?? 0)) continue;
    best = {
      mode,
      bounds: {
        x: found.x - g.dx,
        y: found.y - g.dy,
        width: Math.round(FTune.cell * Columns),
        height: Math.round(FTune.cell * Rows),
      },
      cellSize: FTune.cell,
      anchorScore: found.score,
    };
  }
  return best;
}

/** CellBox (FavoursLocator.cs:47-57). */
export function favoursCellBox(grid: FavoursGrid, x: number, y: number, w: number, h: number): Box {
  const left = Math.round(grid.bounds.x + x * grid.cellSize),
    top = Math.round(grid.bounds.y + y * grid.cellSize);
  return {
    x: left,
    y: top,
    width: Math.round(grid.bounds.x + (x + w) * grid.cellSize) - left,
    height: Math.round(grid.bounds.y + (y + h) * grid.cellSize) - top,
  };
}

// ─── GameView (GameView.cs:35-65, 101-116) ───────────────────────────────────

export interface GameView {
  /** Часть клиентской области, где лежит игра (в её пикселях). */
  game: Box;
  /** Пикселей игры на пиксель reference = up/down. */
  scale: number;
  reference: { width: number; height: number };
  readonly up: number;
  readonly down: number;
}

function gcd(a: number, b: number): number {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** GameView.Of (GameView.cs:35-65). */
export function gameViewOf(width: number, height: number): GameView {
  const RefH = SCREEN_TUNING.referenceHeight;
  let up = 1,
    down = 1;
  if (Math.abs(height / RefH - 1) >= SCREEN_TUNING.sameScale) {
    const common = gcd(height, RefH);
    up = height / common;
    down = RefH / common;
  }
  let shown = Math.min(width, Math.round(height * SCREEN_TUNING.widestAspect));
  const left = Math.floor((width - shown) / 2);
  let reference: number;
  if (down <= SCREEN_TUNING.longestStep) {
    shown -= shown % up;
    reference = Math.floor(shown / up) * down;
  } else reference = Math.round((shown * down) / up);
  return {
    game: { x: left, y: 0, width: shown, height },
    scale: up / down,
    reference: { width: reference, height: up === down ? height : RefH },
    up,
    down,
  };
}

/**
 * GameView.Read + Placed (GameView.cs:69-74, 101-116), MVP: весь кадр.
 * client — client area целиком (BGRA); выход — reference-картинка (высота 1440).
 */
export function gameViewReadWhole(client: BgraFrame, view: GameView): BgraFrame {
  const part = roiView(client, view.game);
  const to = { width: view.reference.width, height: view.reference.height };
  const out = new Uint8Array(to.width * to.height * 4);
  if (view.up === view.down) {
    copyViewTo(part, out, to);
  } else if (view.up > view.down) {
    const sized = resizeAreaBgr(part, to.width, to.height);
    scatterBgr(sized, out, to);
  } else {
    const sized = resizeCubicBgr(part, to.width, to.height);
    scatterBgr(sized, out, to);
  }
  return { width: to.width, height: to.height, data: out };
}

function copyViewTo(view: RoiView, out: Uint8Array, to: { width: number; height: number }): void {
  const px = { b: 0, g: 0, r: 0 };
  for (let y = 0; y < to.height; y++)
    for (let x = 0; x < to.width; x++) {
      view.at(x, y, px);
      const i = (y * to.width + x) << 2;
      out[i] = px.b;
      out[i + 1] = px.g;
      out[i + 2] = px.r;
      out[i + 3] = 255;
    }
}

function scatterBgr(img: BgrImage, out: Uint8Array, to: { width: number; height: number }): void {
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    out[i * 4] = img.b[i];
    out[i * 4 + 1] = img.g[i];
    out[i * 4 + 2] = img.r[i];
    out[i * 4 + 3] = 255;
  }
  void to;
}

/** Point (GameView.cs:119-120): точка клиентской области на reference-картинке. */
export function gameViewPoint(view: GameView, client: { x: number; y: number }): { x: number; y: number } | null {
  const g = view.game;
  const inGame = client.x >= g.x && client.x < boxRight(g) && client.y >= g.y && client.y < boxBottom(g);
  return inGame
    ? { x: Math.trunc((client.x - g.x) / view.scale), y: Math.trunc((client.y - g.y) / view.scale) }
    : null;
}

// ─── RegionPartitioner (RegionPartitioner.cs:15-74; UInt128 → bigint) ────────

export interface RegionCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  index: number;
}

interface Trace {
  index: number;
  previous: Trace | null;
}

interface PState {
  covered: bigint;
  score: number;
  trace: Trace | null;
}

/** Select (RegionPartitioner.cs:15-74): beam=96, score = w·h·evidence². */
export function regionPartitionerSelect(candidates: RegionCandidate[], width: number, height: number): number[] {
  if (width <= 0 || height <= 0 || width * height > 128) throw new Error('regionPartitioner: сетка > 128 ячеек');
  const groups = new Map<number, RegionCandidate[]>();
  for (const c of candidates) {
    const key = c.y * width + c.x;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }
  let states: PState[] = [{ covered: 0n, score: 0, trace: null }];
  for (let cell = 0; cell < width * height; cell++) {
    const next = new Map<bigint, PState>();
    for (const state of states) {
      const options = (state.covered & (1n << BigInt(cell))) !== 0n ? undefined : groups.get(cell);
      if (!options) {
        mergeState(next, state);
        continue;
      }
      for (const p of options) {
        let mask = 0n;
        for (let y = p.y; y < p.y + p.height; y++)
          for (let x = p.x; x < p.x + p.width; x++) mask |= 1n << BigInt(y * width + x);
        if ((mask & state.covered) !== 0n) continue;
        const evidence = Math.max(0.01, p.score);
        const covered = state.covered | mask;
        const score = state.score + p.width * p.height * evidence * evidence;
        const existing = next.get(covered);
        if (!existing || score > existing.score) next.set(covered, { covered, score, trace: { index: p.index, previous: state.trace } });
      }
    }
    // Past coverage cannot affect future choices; merge equivalent frontiers.
    const past = cell === 127 ? -1n : (1n << BigInt(cell + 1)) - 1n;
    const merged = new Map<bigint, PState>();
    for (const s of next.values()) {
      const key = s.covered & ~past;
      const old = merged.get(key);
      if (!old || s.score > old.score) merged.set(key, s);
    }
    states = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 96);
  }
  let bestState: PState | null = null;
  for (const s of states) if (!bestState || s.score > bestState.score) bestState = s;
  const regions: number[] = [];
  for (let t = bestState?.trace ?? null; t; t = t.previous) regions.push(t.index);
  regions.reverse();
  return regions;
}

function mergeState(next: Map<bigint, PState>, state: PState): void {
  const old = next.get(state.covered);
  if (!old || state.score > old.score) next.set(state.covered, state);
}

// ─── GridPicture / CellLook / CellMemory (CellMemory.cs:7-210) ──────────────

/** GridPicture (CellMemory.cs:7-25): серые пиксели сетки одного кадра. */
export interface GridPicture {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export function gridPictureOf(frame: BgraFrame, grid: FavoursGrid): GridPicture {
  const boundsW = grid.bounds.width,
    boundsH = grid.bounds.height;
  const pixels = new Uint8Array(boundsW * boundsH);
  const area = boxIntersect(grid.bounds, { x: 0, y: 0, width: frame.width, height: frame.height });
  if (area.width <= 0 || area.height <= 0) return { pixels, width: boundsW, height: boundsH };
  const dx = area.x - grid.bounds.x,
    dy = area.y - grid.bounds.y;
  for (let y = 0; y < area.height; y++) {
    const srcRow = (area.y + y) * frame.width + area.x;
    for (let x = 0; x < area.width; x++) {
      const i = (srcRow + x) << 2;
      pixels[(y + dy) * boundsW + (dx + x)] = clamp255(
        Math.round(0.299 * frame.data[i + 2] + 0.587 * frame.data[i + 1] + 0.114 * frame.data[i]),
      );
    }
  }
  return { pixels, width: boundsW, height: boundsH };
}

/** CellLook (CellMemory.cs:31-84): яркость (медиана отношений) и структура (corr). */
export interface CellLook {
  brightness: number;
  structure: number;
  covered: boolean;
  uncovered: boolean;
  visible: boolean;
  replaced: boolean;
  same: boolean;
}

export function cellLookBetween(then: ArrayLike<number>, now: ArrayLike<number>): CellLook {
  const n = Math.min(then.length, now.length);
  const ratios: number[] = new Array(n);
  let measurable = 0,
    sumThen = 0,
    sumNow = 0,
    thenThen = 0,
    nowNow = 0,
    thenNow = 0;
  for (let i = 0; i < n; i++) {
    const was = then[i],
      seen = now[i];
    if (was > FTune.darkPixel) ratios[measurable++] = seen / was;
    sumThen += was;
    sumNow += seen;
    thenThen += was * was;
    nowNow += seen * seen;
    thenNow += was * seen;
  }
  const spread = (thenThen - (sumThen * sumThen) / n) * (nowNow - (sumNow * sumNow) / n);
  const structure = spread > 0 ? (thenNow - (sumThen * sumNow) / n) / Math.sqrt(spread) : 0;
  let brightness: number;
  if (measurable >= FTune.measurablePixels) {
    const head = ratios.slice(0, measurable).sort((a, b) => a - b);
    brightness = head[Math.floor(measurable / 2)];
  } else brightness = (sumNow / n + 1) / (sumThen / n + 1);
  return makeCellLook(brightness, structure);
}

function makeCellLook(brightness: number, structure: number): CellLook {
  const covered = brightness < FTune.coveredBelow;
  const uncovered = brightness > 1 / FTune.coveredBelow;
  const visible = !covered && !uncovered;
  const replaced = structure < FTune.replacedBelow;
  const same = visible && structure >= FTune.sameStructure;
  return { brightness, structure, covered, uncovered, visible, replaced, same };
}

/** CellMemory (CellMemory.cs:91-210): immutable память ячеек сетки. */
export class CellMemory {
  readonly columns = Columns;
  readonly rows = Rows;

  private constructor(
    private readonly grid: FavoursGrid,
    private readonly pixels: Uint8Array,
    private readonly stored: boolean[],
    private readonly occupied: boolean[],
  ) {}

  static empty(grid: FavoursGrid): CellMemory {
    return new CellMemory(grid, new Uint8Array(grid.bounds.width * grid.bounds.height), new Array(Columns * Rows).fill(false), new Array(Columns * Rows).fill(false));
  }

  isStored(cell: number): boolean {
    return this.stored[cell];
  }

  isOccupied(cell: number): boolean {
    return this.occupied[cell];
  }

  get anyUnread(): boolean {
    return this.stored.some((s) => !s);
  }

  /** Место ячейки внутри grid-картинки (Place, CellMemory.cs:119-123). */
  private place(cell: number): Box {
    const box = favoursCellBox(this.grid, cell % Columns, Math.floor(cell / Columns), 1, 1);
    return boxIntersect(
      { x: box.x - this.grid.bounds.x, y: box.y - this.grid.bounds.y, width: box.width, height: box.height },
      { x: 0, y: 0, width: this.grid.bounds.width, height: this.grid.bounds.height },
    );
  }

  /** With (CellMemory.cs:126-140). */
  with(now: GridPicture, cells: Iterable<number>, isOccupied: (cell: number) => boolean): CellMemory {
    const next = this.pixels.slice();
    const has = this.stored.slice();
    const used = this.occupied.slice();
    for (const cell of cells) {
      const at = this.place(cell);
      if (at.width <= 0 || at.height <= 0) continue;
      for (let y = 0; y < at.height; y++)
        for (let x = 0; x < at.width; x++)
          next[(at.y + y) * now.width + at.x + x] = now.pixels[(at.y + y) * now.width + at.x + x];
      has[cell] = true;
      used[cell] = isOccupied(cell);
    }
    return new CellMemory(this.grid, next, has, used);
  }

  /** Look(now) — все сохранённые ячейки (CellMemory.cs:143-150); null = не читана. */
  lookAll(now: GridPicture): (CellLook | null)[] {
    const looks: (CellLook | null)[] = new Array(Columns * Rows).fill(null);
    for (let cell = 0; cell < looks.length; cell++) if (this.stored[cell]) looks[cell] = this.compare(now, this.place(cell));
    return looks;
  }

  /** Look(now, spot) — место ценника предмета (CellMemory.cs:153-158). */
  lookSpot(now: GridPicture, spot: Box): CellLook | null {
    const at = boxIntersect(
      { x: spot.x - this.grid.bounds.x, y: spot.y - this.grid.bounds.y, width: spot.width, height: spot.height },
      { x: 0, y: 0, width: this.grid.bounds.width, height: this.grid.bounds.height },
    );
    return at.width <= 0 || at.height <= 0 ? null : this.compare(now, at);
  }

  private compare(now: GridPicture, at: Box): CellLook {
    const n = at.width * at.height;
    const then = new Uint8Array(n),
      seen = new Uint8Array(n);
    for (let y = 0; y < at.height; y++)
      for (let x = 0; x < at.width; x++) {
        const offset = (at.y + y) * now.width + at.x + x;
        then[y * at.width + x] = this.pixels[offset];
        seen[y * at.width + x] = now.pixels[offset];
      }
    return cellLookBetween(then, seen);
  }

  /** LooksEmpty (CellMemory.cs:175-196): ячейка выглядит как пустая (орнамент). */
  looksEmpty(now: GridPicture, cell: number): boolean {
    const at = this.place(cell);
    let tried = 0;
    for (let other = 0; other < this.stored.length && tried < 3; other++) {
      if (!this.stored[other] || this.occupied[other] || other === cell) continue;
      tried++;
      const like = this.place(other);
      const w = Math.min(at.width, like.width),
        h = Math.min(at.height, like.height);
      const deviations: number[] = new Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          deviations[y * w + x] = Math.abs(now.pixels[(at.y + y) * now.width + at.x + x] - this.pixels[(like.y + y) * now.width + like.x + x]);
      deviations.sort((a, b) => a - b);
      if (deviations[Math.floor(deviations.length / 2)] <= FTune.emptyDeviation) return true;
    }
    return false;
  }

  /** StillThere (CellMemory.cs:199-203): окно всё ещё открыто. */
  stillThere(now: GridPicture): boolean {
    const looks = this.lookAll(now).filter((l): l is CellLook => l !== null);
    return looks.length > 0 && looks.filter((l) => l.same).length >= looks.length * FTune.stillThere;
  }

  /** WindowDimmed (CellMemory.cs:206-210): диалог затемнил всё окно. */
  static windowDimmed(looks: (CellLook | null)[]): boolean {
    const seen = looks.filter((l): l is CellLook => l !== null);
    return seen.length > 0 && seen.filter((l) => l.brightness < FTune.dimmedBelow).length >= seen.length * FTune.windowDimmed;
  }
}
