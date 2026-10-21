import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePng } from '../src/png.js';
import {
  CellMemory,
  ItemGround,
  anchorInRow,
  boxIntersect,
  boxUnion,
  cellLookBetween,
  cellOccupiedPixels,
  correlation,
  colorPenalty,
  descriptorScore,
  describe as describeRoi,
  favoursCellBox,
  frameView,
  gameViewOf,
  gameViewPoint,
  gameViewReadWhole,
  gridPictureOf,
  locateFavoursGrid,
  nccBest,
  regionPartitionerSelect,
  type BgraFrame,
  type Box,
  type GrayImage,
} from '../src/ritualVision.js';
import {
  buildRitualReferences,
  loadRitualAnchor,
  recognizeFavours,
  resetRitualCaches,
  ritualLabelSpot,
} from '../src/ritualReferences.js';
import { FAVOURS_TUNING, getOfficialReferences, getRitualCatalog, ritualAssetPath } from '../src/ritual.js';

// №584 этапы 1–3: порт poe2pricer (MIT saxe78) — математика распознавания.
// Пороги донора перенесены дословно; замены OpenCV (INTER_AREA→box-фильтр,
// MatchTemplate→NCC) проверяются на поведенческих инвариантах, а не битах OpenCV.

function frameOf(width: number, height: number, fill: (x: number, y: number, out: { b: number; g: number; r: number }) => void): BgraFrame {
  const data = new Uint8Array(width * height * 4);
  const out = { b: 0, g: 0, r: 0 };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      fill(x, y, out);
      const i = (y * width + x) << 2;
      data[i] = out.b;
      data[i + 1] = out.g;
      data[i + 2] = out.r;
      data[i + 3] = 255;
    }
  return { width, height, data };
}

const solidFrame = (width: number, height: number, b: number, g: number, r: number): BgraFrame =>
  frameOf(width, height, (_x, _y, o) => {
    o.b = b;
    o.g = g;
    o.r = r;
  });

const gridOf = (x = 10, y = 20) => ({
  mode: 'keyboard' as const,
  bounds: { x, y, width: Math.round(70.18 * 12), height: Math.round(70.18 * 10) },
  cellSize: 70.18,
  anchorScore: 1,
});

// ─── PNG-декодер ──────────────────────────────────────────────────────────────

describe('png: минимальный декодер', () => {
  it('декодирует якорь favours-tribute-bar.png (80×95, RGBA), пиксели не пустые', () => {
    const img = decodePng(readFileSync(ritualAssetPath(`ui/${FAVOURS_TUNING.anchorFile}`)));
    expect(img.width).toBe(80);
    expect(img.height).toBe(95);
    expect(img.data.length).toBe(80 * 95 * 4);
    let sum = 0;
    for (let i = 0; i < img.data.length; i += 4) sum += img.data[i] + img.data[i + 1] + img.data[i + 2];
    expect(sum).toBeGreaterThan(0);
  });

  it('бросок на не-PNG', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
  });

  it('декодирует иконку каталога (64×64 currency, RGBA colorType=6)', () => {
    const img = decodePng(readFileSync(ritualAssetPath('catalog/official-images/a83e3a971b6e478e93f5be3a.png')));
    expect(img.width).toBe(64);
    expect(img.height).toBe(64);
    expect(img.colorType).toBe(6);
  });
});

// ─── Геометрия ───────────────────────────────────────────────────────────────

describe('ritualVision: Box/geometry (Rect-семантика донора)', () => {
  it('union/intersect', () => {
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const b: Box = { x: 5, y: 5, width: 10, height: 10 };
    expect(boxUnion(a, b)).toEqual({ x: 0, y: 0, width: 15, height: 15 });
    expect(boxIntersect(a, b, { x: 0, y: 0, width: 100, height: 100 })).toEqual({ x: 5, y: 5, width: 5, height: 5 });
  });

  it('CellBox: ячейки от origin, ширина через round-разность (FavoursLocator.cs:47-57)', () => {
    const grid = gridOf(100, 500);
    const cell = favoursCellBox(grid, 0, 0, 1, 1);
    expect(cell.x).toBe(100);
    expect(cell.y).toBe(500);
    expect(cell.width).toBe(Math.round(100 + 70.18) - 100);
    const wide = favoursCellBox(grid, 2, 3, 2, 4);
    expect(wide.x).toBe(Math.round(100 + 2 * 70.18));
    expect(wide.width).toBe(Math.round(100 + 4 * 70.18) - Math.round(100 + 2 * 70.18));
  });

  it('ritualLabelSpot: 56×28 у нижней кромки, по центру', () => {
    const spot = ritualLabelSpot({ x: 0, y: 0, width: 140, height: 280 });
    expect(spot.width).toBe(56);
    expect(spot.height).toBe(28);
    expect(spot.x).toBe(42); // центр 70 − 28
    expect(spot.y).toBe(252);
  });
});

// ─── GameView (GameView.cs:35-65) ─────────────────────────────────────────────

describe('ritualVision: GameView (масштабирование к 1440)', () => {
  it('1920×1080 → up/down 3/4, reference 2560×1440, игра целиком', () => {
    const v = gameViewOf(1920, 1080);
    expect(v.up).toBe(3);
    expect(v.down).toBe(4);
    expect(v.reference).toEqual({ width: 2560, height: 1440 });
    expect(v.game).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('2560×1440 → identity (sameScale-допуск)', () => {
    const v = gameViewOf(2560, 1440);
    expect(v.up).toBe(1);
    expect(v.down).toBe(1);
    expect(v.reference).toEqual({ width: 2560, height: 1440 });
    expect(v.scale).toBe(1);
  });

  it('3440×1440 (2.39:1) → без чёрных полос', () => {
    const v = gameViewOf(3440, 1440);
    expect(v.game.width).toBe(3440);
  });

  it('3440×1296 — шире 2.4:1: шаги up=9, ширина режется до кратного 9', () => {
    const v = gameViewOf(3440, 1296);
    expect(v.game.width).toBe(3105); // 3110 − 3110%9
    expect(v.reference.width).toBe(3105 / 9 * 10);
  });

  it('gameViewReadWhole: сплошной цвет сохраняется после area-приведения', () => {
    const client = solidFrame(1920, 1080, 10, 200, 30);
    const ref = gameViewReadWhole(client, gameViewOf(1920, 1080));
    expect(ref.width).toBe(2560);
    expect(ref.height).toBe(1440);
    const px = (ref.width * 700 + 130) << 2;
    expect(ref.data[px]).toBe(10);
    expect(ref.data[px + 1]).toBe(200);
    expect(ref.data[px + 2]).toBe(30);
    expect(ref.data[px + 3]).toBe(255);
  });

  it('gameViewPoint: точка клиента → reference', () => {
    const v = gameViewOf(1920, 1080);
    expect(gameViewPoint(v, { x: 960, y: 540 })).toEqual({ x: 1280, y: 720 });
    expect(gameViewPoint(v, { x: -1, y: 0 })).toBeNull();
  });
});

// ─── ItemGround / Occupied (ItemGround.cs, Recognizer.cs:328-350) ─────────────

describe('ritualVision: ItemGround + Occupied', () => {
  it('предикаты фона (BGR-порядок: b=Item0!)', () => {
    expect(ItemGround.blue({ b: 120, g: 60, r: 40 })).toBe(true);
    expect(ItemGround.red({ b: 40, g: 60, r: 120 })).toBe(true);
    expect(ItemGround.green({ b: 40, g: 120, r: 60 })).toBe(true);
    expect(ItemGround.any({ b: 20, g: 20, r: 20 })).toBe(false);
  });

  it('occupied: сплошной синий → true, тёмный орнамент → false (доли донора)', () => {
    const grid = gridOf(0, 0);
    const blue = solidFrame(1000, 800, 120, 60, 40);
    expect(cellOccupiedPixels(blue, favoursCellBox(grid, 2, 3, 1, 1), grid.cellSize)).toBe(true);
    const dark = solidFrame(1000, 800, 20, 20, 22);
    expect(cellOccupiedPixels(dark, favoursCellBox(grid, 2, 3, 1, 1), grid.cellSize)).toBe(false);
  });
});

// ─── Describe / Correlation / Score (Recognizer.cs:352-448) ───────────────────

describe('ritualVision: Describe/Correlation/Score', () => {
  // НЕ константы: Pearson-корреляция констант неопределена (донор смотри через variance)
  const gray = new Float32Array(1152).map((_, i) => 100 + (i % 17));
  const edge = new Float32Array(1152).map((_, i) => 5 + (i % 13));
  const mask = new Float32Array(1152).fill(1);
  const flatColor = new Array(1152 * 3).fill(1 / 3);

  it('корреляция идентичных дескрипторов = 1, нулевая маска → -1', () => {
    expect(correlation(gray, gray, mask)).toBeCloseTo(1, 6);
    expect(correlation(gray, gray, new Float32Array(1152))).toBe(-1);
  });

  it('антикорреляция = -1', () => {
    const inv = new Float32Array(1152).map((_, i) => 255 - gray[i]);
    expect(correlation(gray, inv, mask)).toBeCloseTo(-1, 6);
  });

  it('colorPenalty: 0 на одинаковом grayscale, >0 на насыщенном отклонении', () => {
    expect(colorPenalty(flatColor, flatColor, mask)).toBe(0);
    const hue = new Array(1152 * 3).fill(0);
    for (let i = 0; i < 1152; i++) {
      hue[i * 3] = 0.9;
      hue[i * 3 + 1] = 0.05;
      hue[i * 3 + 2] = 0.05;
    }
    expect(colorPenalty(hue, flatColor, mask)).toBeGreaterThan(0);
  });

  it('score идентичного референса = 1; MinimumScore выше → -1 (Recognizer.cs:358)', () => {
    const ref = { gray, edge, color: flatColor, mask, minimumScore: 0 };
    expect(descriptorScore(ref, gray, edge, flatColor)).toBeCloseTo(1, 6);
    expect(descriptorScore({ ...ref, minimumScore: 0.95 }, gray, edge, flatColor)).toBeCloseTo(1, 6);
    expect(descriptorScore({ ...ref, minimumScore: 1.01 }, gray, edge, flatColor)).toBe(-1);
  });

  it('describe: сплошное → edge=0 и gray≈цвет; градиент → edge>0', () => {
    const solid = describeRoi(frameView(solidFrame(70, 140, 100, 100, 100)));
    expect(Math.max(...solid.edge)).toBe(0);
    expect(solid.gray.every((g) => Math.abs(g - 100) <= 1)).toBe(true);
    const gradient = frameOf(70, 140, (x, _y, o) => {
      const v = Math.min(255, x * 4);
      o.b = o.g = o.r = v;
    });
    expect(Math.max(...describeRoi(frameView(gradient)).edge)).toBeGreaterThan(0);
  });
});

// ─── Anchor / NCC (Anchor.cs:18-30) ───────────────────────────────────────────

describe('ritualVision: Anchor NCC (якорь favours-tribute-bar)', () => {
  const anchor = loadRitualAnchor();

  it('якорь загружен 80×95 (RGBA PNG из датасета)', () => {
    expect(anchor.width).toBe(80);
    expect(anchor.height).toBe(95);
  });

  it('вставляет реальный якорь в шумный кадр — находит точную позицию, score>.9', () => {
    const frame = frameOf(2480, 1300, (x, y, o) => {
      const v = ((x * 7 + y * 13) % 32) + 24;
      o.b = o.g = o.r = v;
    });
    const src = decodePng(readFileSync(ritualAssetPath(`ui/${FAVOURS_TUNING.anchorFile}`)));
    for (let y = 0; y < 95; y++)
      for (let x = 0; x < 80; x++) {
        const g = Math.round(0.299 * src.data[(y * 80 + x) * 4] + 0.587 * src.data[(y * 80 + x) * 4 + 1] + 0.114 * src.data[(y * 80 + x) * 4 + 2]);
        const i = ((1000 + y) * 2480 + 500 + x) << 2;
        frame.data[i] = g;
        frame.data[i + 1] = g;
        frame.data[i + 2] = g;
      }
    const found = anchorInRow(frame, anchor, 1000, 16);
    expect(found).not.toBeNull();
    expect(found!.x).toBe(500);
    expect(found!.y).toBe(1000);
    expect(found!.score).toBeGreaterThan(0.9);
  });

  it('полоса без якоря → score ниже порога 0.7', () => {
    const frame = frameOf(2480, 1300, (x, y, o) => {
      const v = ((x * 5 + y * 11) % 24) + 30;
      o.b = o.g = o.r = v;
    });
    const found = anchorInRow(frame, anchor, 200, 16);
    expect(found === null || found.score < FAVOURS_TUNING.minimumAnchorScore).toBe(true);
  });

  it('nccBest: точный шаблон из полосы → CCoeffNormed=1 в его позиции', () => {
    // ❗ не арифметика (вида (i*37)%251): локально-линейные данные дают NCC=1
    // в нескольких позициях. Seeded-псевдослучайный band — пик уникален.
    const band: GrayImage = { width: 20, height: 10, data: new Uint8Array(200) };
    let seed = 123456789;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 251);
    for (let i = 0; i < 200; i++) band.data[i] = rnd();
    const tplData = new Uint8Array(50);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 10; x++) tplData[y * 10 + x] = band.data[(y + 2) * 20 + (x + 3)];
    const best = nccBest(band, { width: 10, height: 5, data: tplData });
    expect(best).not.toBeNull();
    expect(best!.x).toBe(3);
    expect(best!.y).toBe(2);
    expect(best!.score).toBeCloseTo(1, 6);
  });

  it('locateFavoursGrid: якорь в эталонной строке keyboard → сетка от origin (−dx,−dy)', () => {
    const frame = frameOf(2560, 1440, (x, y, o) => {
      const v = ((x * 7 + y * 13) % 32) + 24;
      o.b = o.g = o.r = v;
    });
    const g = FAVOURS_TUNING.gridTop.keyboard;
    const src = decodePng(readFileSync(ritualAssetPath(`ui/${FAVOURS_TUNING.anchorFile}`)));
    const ax = 760,
      ay = g.top + g.dy;
    for (let y = 0; y < 95; y++)
      for (let x = 0; x < 80; x++) {
        const i = ((ay + y) * 2560 + ax + x) << 2;
        frame.data[i] = src.data[(y * 80 + x) * 4 + 2];
        frame.data[i + 1] = src.data[(y * 80 + x) * 4 + 1];
        frame.data[i + 2] = src.data[(y * 80 + x) * 4];
      }
    const grid = locateFavoursGrid(frame, anchor);
    expect(grid).not.toBeNull();
    expect(grid!.mode).toBe('keyboard');
    expect(grid!.bounds.x).toBe(ax - g.dx);
    expect(grid!.bounds.y).toBe(ay - g.dy);
  });
});

// ─── RegionPartitioner (RegionPartitioner.cs:15-74) ───────────────────────────

describe('ritualVision: RegionPartitioner (bigint вместо UInt128)', () => {
  it('multi-cell не даёт разрезать себя 1×1-кандидатами', () => {
    const sel = regionPartitionerSelect(
      [
        { x: 0, y: 0, width: 1, height: 1, score: 0.7, index: 0 },
        { x: 1, y: 0, width: 1, height: 1, score: 0.7, index: 1 },
        { x: 0, y: 0, width: 2, height: 1, score: 0.7, index: 2 },
      ],
      12,
      10,
    );
    expect(sel).toEqual([2]);
  });

  it('независимые ячейки выбираются вместе', () => {
    const sel = regionPartitionerSelect(
      [
        { x: 0, y: 0, width: 1, height: 1, score: 0.7, index: 0 },
        { x: 5, y: 3, width: 1, height: 1, score: 0.6, index: 1 },
        { x: 11, y: 9, width: 1, height: 1, score: 0.5, index: 2 },
      ],
      12,
      10,
    );
    expect([...sel].sort()).toEqual([0, 1, 2]);
  });

  it('evidence²: два кандидата на одной ячейке — выбирается сильный', () => {
    // Донор не исключает кандидаты на РАЗНЫХ ячейках (они независимы); конкуренция
    // доказывается на одном месте (0,0): 0.9²=0.81 > 0.3²=0.09.
    const sel = regionPartitionerSelect(
      [
        { x: 0, y: 0, width: 1, height: 1, score: 0.9, index: 0 },
        { x: 0, y: 0, width: 1, height: 1, score: 0.3, index: 1 },
      ],
      12,
      10,
    );
    expect(sel).toEqual([0]);
  });
});

// ─── CellMemory / CellLook / GridPicture (CellMemory.cs) ──────────────────────

describe('ritualVision: CellLook/GridPicture/CellMemory', () => {
  it('между одинаковыми кадрами: brightness 1, structure 1, same', () => {
    const a = new Uint8Array(2500).map((_, i) => i % 251);
    const look = cellLookBetween(a, a);
    expect(look.brightness).toBeCloseTo(1, 6);
    expect(look.structure).toBeCloseTo(1, 6);
    expect(look.same).toBe(true);
  });

  it('затемнение до 30% → covered (CoveredBelow .4)', () => {
    const then = new Uint8Array(2500).map((_, i) => i % 251);
    const now = new Uint8Array(2500).map((_, i) => Math.trunc(((i % 251) * 0.3)));
    const look = cellLookBetween(then, now);
    expect(look.covered).toBe(true);
    expect(look.visible).toBe(false);
  });

  it('замена картинки (тултип) → replaced: structure < .2', () => {
    const then = new Uint8Array(2500).map((_, i) => i % 251);
    const now = new Uint8Array(2500).map((_, i) => (i * 11 + 5) % 251);
    const look = cellLookBetween(then, now);
    expect(look.structure).toBeLessThan(FAVOURS_TUNING.replacedBelow);
    expect(look.replaced).toBe(true);
  });

  it('GridPicture: серый кроп сетки; часть вне кадра — чёрная', () => {
    const frame = solidFrame(2000, 500, 30, 240, 90); // серый ≈ 0.587·240 ≈ 141
    const pic = gridPictureOf(frame, gridOf(10, 20));
    expect(pic.width).toBe(Math.round(70.18 * 12));
    expect(pic.pixels[100 * pic.width + 100]).toBeGreaterThan(130);
    // сетка уходит за низ кадра (500): последние строки подарка чёрные
    expect(pic.pixels[(pic.height - 1) * pic.width + 100]).toBe(0);
  });

  it('CellMemory.with → stillThere=true; затемнение → windowDimmed=true', () => {
    const grid = gridOf(10, 20);
    // ❗ плоский кадр -> spread=0 -> structure=0 -> same=false (семантика донора):
    // cellLook требует текстуры, поэтому фон — периодический орнамент.
    const frame = frameOf(2000, 1200, (x, y, o) => {
      const v = 24 + ((x % 13) * 2 + (y % 11) * 3);
      o.b = o.g = o.r = v;
    });
    const pic = gridPictureOf(frame, grid);
    const cells = [0, 1, 2, 13, 26, 40, 55, 70, 85, 100];
    const mem = CellMemory.empty(grid).with(pic, cells, () => true);
    for (const c of cells) expect(mem.isStored(c)).toBe(true);
    expect(mem.stillThere(pic)).toBe(true);
    expect(mem.anyUnread).toBe(true);
    const looks = mem.lookAll(pic);
    expect(looks.filter(Boolean)).toHaveLength(cells.length);
    expect(CellMemory.windowDimmed(looks)).toBe(false);
    const dimPic = { pixels: new Uint8Array(pic.pixels.map((v) => Math.trunc(v * 0.3))), width: pic.width, height: pic.height };
    expect(CellMemory.windowDimmed( mem.lookAll(dimPic))).toBe(true);
    expect(mem.stillThere(dimPic)).toBe(false);
  });

  it('looksEmpty: пустая ячейка совпадает с сохранённой пустой', () => {
    const grid = gridOf(10, 20);
    // пустые ячейки (5 и 80-я) — один и тот же орнамент; ячейка 37 занята синим
    const frame = frameOf(2000, 1200, (x, y, o) => {
      const col = Math.floor((x - 10) / 70.18),
        row = Math.floor((y - 20) / 70.18);
      const cell = row * 12 + col;
      if (cell === 5 || cell === 80) o.b = o.g = o.r = 60;
      else if (cell === 37) {
        o.b = 120;
        o.g = o.r = 0;
      } else {
        o.b = o.g = o.r = 25;
      }
    });
    const pic = gridPictureOf(frame, grid);
    const mem = CellMemory.empty(grid).with(pic, [5, 80, 37], (c) => c === 37);
    expect(mem.isOccupied(37)).toBe(true);
    expect(mem.looksEmpty(pic, 5)).toBe(true);
  });
});

// ─── Референсы + Recognize (Recognizer.cs:53-288), тяжёлый smoke ─────────────

describe('ritualReferences: каталог → референсы → recognize', () => {
  it('buildRitualReferences: >900 референсов, learned помечены, вариация omen присутствует', () => {
    resetRitualCaches();
    const refs = buildRitualReferences();
    expect(refs.length).toBeGreaterThan(900); // 956 предметов, у части вариации/padding
    const learned = refs.filter((r) => r.trained).length;
    expect(learned).toBe(177); // recognition-model.json
    const omenId = getRitualCatalog().items.find((i) => i.id.startsWith('Omen_') && i.width === 1 && i.height === 1)?.id;
    if (omenId) expect(refs.filter((r) => r.item.id === omenId).length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('recognizeFavours: иконка каталога в ячейке бьёт чужие референсы (реляционный тест)', () => {
    resetRitualCaches();
    const refs = buildRitualReferences();
    // ❗ buildRitualReferences строит референс из official-арты (official.get(id) ?? item.image,
    // ritualReferences.ts:128) — рисуем именно official-иконку, иначе source mismatch → corr≈0.
    const officialEntries = (getOfficialReferences().items as { catalogId: string; image: string }[])
      .map((o) => ({ o, item: getRitualCatalog().items.find((i) => i.id === o.catalogId) }))
      .find(({ item }) => item && item.kind === 'currency' && item.width === 1 && item.height === 1)!;
    const item = officialEntries.item!;
    const img = decodePng(readFileSync(ritualAssetPath(`catalog/${officialEntries.o.image}`)));
    // reference самого предмета (1×1-группа, trained=false)
    const self = refs.find((r) => r.item.id === item.id && !r.trained)!;
    // чужой 1×1-референс
    const other = refs.find((r) => r.item.id !== item.id && !r.trained && r.item.width === 1 && r.item.height === 1)!;
    // рисуем иконку в ячейке (2,3) сетки на кадре 2560×1440
    const grid = {
      mode: 'keyboard' as const,
      bounds: { x: 760, y: 1000, width: Math.round(70.18 * 12), height: Math.round(70.18 * 10) },
      cellSize: 70.18,
      anchorScore: 1,
    };
    // сетка целиком должна влезть в кадр 1440
    const frame = solidFrame(2560, 1440, 25, 25, 25);
    const box = favoursCellBox(grid, 2, 3, 1, 1);
    const scale = Math.min((box.width - 2) / img.width, (box.height - 2) / img.height);
    for (let y = 0; y < img.height * scale; y++)
      for (let x = 0; x < img.width * scale; x++) {
        const sx = Math.min(img.width - 1, Math.floor(x / scale)),
          sy = Math.min(img.height - 1, Math.floor(y / scale));
        const a = img.data[(sy * img.width + sx) * 4 + 3] / 255;
        const i = ((box.y + 1 + y) * 2560 + box.x + 1 + x) << 2;
        frame.data[i] = Math.round(img.data[(sy * img.width + sx) * 4 + 2] * a + 25 * (1 - a)); // premultiplied на тёмный фон
        frame.data[i + 1] = Math.round(img.data[(sy * img.width + sx) * 4 + 1] * a + 25 * (1 - a));
        frame.data[i + 2] = Math.round(img.data[(sy * img.width + sx) * 4] * a + 25 * (1 - a));
      }
    // ячейка занята?
    expect(cellOccupiedPixels(frame, box, grid.cellSize)).toBe(true);
    // дескрипторы ячейки: свой референс ≥ чужого
    const rec = recognizeFavours(frame, grid, refs);
    const match = rec.items.find((m) => m.column === 2 && m.row === 3);
    expect(match).toBeDefined();
    if (match) {
      const selfScore = match.candidates.find((c) => c.id === item.id)?.score ?? -1;
      const otherScore = match.candidates.find((c) => c.id === other.item.id)?.score ?? -1;
      expect(selfScore).toBeGreaterThan(otherScore);
    }
  }, 120_000);
});
