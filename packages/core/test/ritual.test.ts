import { describe, it, expect } from 'vitest';
import {
  getRitualCatalog,
  getRecognitionModel,
  getOfficialReferences,
  ritualAssetPath,
  ritualItemById,
  RECOGNITION_TUNING,
  FAVOURS_TUNING,
  FAVOURS_GRID,
} from '../src/ritual.js';
import { existsSync } from 'node:fs';

// №584 этап 0: инварианты датасета Ritual (данные из poe2pricer 1.1.2, MIT saxe78).
describe('ritual: каталог и learned-модель (данные донора, этап 0)', () => {
  it('каталог: 956 предметов, версия 9d4d8a79f16f1e8b, все id уникальны', () => {
    const c = getRitualCatalog();
    expect(c.version).toBe('9d4d8a79f16f1e8b');
    expect(c.items).toHaveLength(956);
    const byId = new Set(c.items.map((i) => i.id));
    expect(byId.size).toBe(c.items.length);
  });

  it('каталог: kind только unique/currency, размеры целые ≥1', () => {
    for (const i of getRitualCatalog().items) {
      expect(['unique', 'currency']).toContain(i.kind);
      expect(i.width).toBeGreaterThanOrEqual(1);
      expect(i.height).toBeGreaterThanOrEqual(1);
    }
  });

  it('модель: schemaVersion=1, 177 прототипов, catalogVersion совпадает с каталогом', () => {
    const m = getRecognitionModel();
    expect(m.schemaVersion).toBe(1);
    expect(m.prototypes).toHaveLength(177);
    expect(m.catalogVersion).toBe(getRitualCatalog().version);
  });

  it('модель: прототипы 24×48 (gray/edge по 1152), ссылки на каталог валидны', () => {
    const m = getRecognitionModel();
    for (const p of m.prototypes) {
      expect(p.gray).toHaveLength(24 * 48);
      expect(p.edge).toHaveLength(24 * 48);
      expect(ritualItemById(p.catalogId)).toBeDefined();
    }
  });

  it('official-references: структура и версия (факт донора: 1bb560c48ccb83a2 ≠ catalog 9d4d8a79)', () => {
    const o = getOfficialReferences();
    expect(o.catalogVersion).toBe('1bb560c48ccb83a2');
    expect(Array.isArray(o.items)).toBe(true);
    expect(o.items.length).toBeGreaterThan(400);
  });

  it('все файлы иконок каталога существуют на диске', () => {
    for (const i of getRitualCatalog().items) {
      expect(existsSync(ritualAssetPath(`catalog/${i.image}`)), i.image).toBe(true);
    }
  });

  it('якорь favours-tribute-bar.png и сетка 12×10 на месте', () => {
    expect(existsSync(ritualAssetPath('ui/favours-tribute-bar.png'))).toBe(true);
    expect(FAVOURS_GRID).toEqual({ columns: 12, rows: 10 }); // CellMemory.cs:93-94
  });

  it('константы Tuning.cs портированы дословно (контрольные точки)', () => {
    // Tuning.Recognition (Tuning.cs:20-79)
    expect(RECOGNITION_TUNING.minimumScore).toBe(0.45);
    expect(RECOGNITION_TUNING.grayWeight).toBe(0.7);
    expect(RECOGNITION_TUNING.edgeWeight).toBe(0.3);
    expect(RECOGNITION_TUNING.learnedMinimumScore).toBe(0.82);
    // Tuning.Favours (Tuning.cs:114-212)
    expect(FAVOURS_TUNING.cell).toBe(70.18);
    expect(FAVOURS_TUNING.gridTop.keyboard).toEqual({ top: 356, dx: 30, dy: 705 });
    expect(FAVOURS_TUNING.gridTop.controller).toEqual({ top: 411, dx: 31, dy: 706 });
    expect(FAVOURS_TUNING.minimumAnchorScore).toBe(0.7);
    expect(FAVOURS_TUNING.sameStructure).toBe(0.8);
  });
});
