import { describe, expect, it, vi } from 'vitest';
import {
  LIVE_FULL_RUN_MS,
  LIVE_RETRY_BACKOFF_MS,
  LIVE_TICK_MS,
  LiveFilterPipeline,
  filterContentKey,
  retryDelayMs,
  type PipelineState,
} from '../src/livefilter/pipeline.js';
import { LIVE_FILTER_SCHEMA_VERSION, type LiveFilterSnapshot } from '../src/livefilter/rules.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Фикстуры ──────────────────────────────────────────────────────────────

function snap(league: string, divineEx: number): LiveFilterSnapshot {
  return {
    schemaVersion: LIVE_FILTER_SCHEMA_VERSION,
    league,
    generatedAt: '2026-10-12T00:00:00Z',
    rates: { divineEx, chaosEx: 0.5 },
    currency: [
      { name: 'Divine Orb', category: 'currency', valueEx: divineEx },
      { name: 'Exalted Orb', category: 'currency', valueEx: 1 },
    ],
    uniqueBases: {},
    exceptional: [],
    sources: {},
  };
}

const BASE = [
  '# base', '#===', '# [[0100]] Override', '#===', '',
  'Show', '    BaseType == "Divine Orb"', '    SetFontSize 45', '',
].join('\n');

/** Ручные часы: t мс; тестируем без vitest fake timers. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function makePipeline(over: {
  snapshot?: LiveFilterSnapshot;
  config?: Record<string, unknown>;
  writes?: string[];
  state?: PipelineState | null;
  onState?: (s: PipelineState) => void;
  getSnapshot?: () => Promise<LiveFilterSnapshot>;
}) {
  const writes = over.writes ?? [];
  const c = clock();
  let snapshot = over.snapshot ?? snap('L', 500);
  let snapCalls = 0;
  const p = new LiveFilterPipeline({
    getSnapshot: over.getSnapshot ?? (() => { snapCalls++; return Promise.resolve(snapshot); }),
    getBaseContent: () => BASE,
    config: { thresholdEx: 10, hideLowRarityGear: false, ...(over.config ?? {}) },
    write: (content) => writes.push(content),
    loadState: () => over.state ?? null,
    saveState: (s) => over.onState?.(s),
    now: c.now,
  });
  return { p, writes, clock: c, setSnapshot: (s: LiveFilterSnapshot) => (snapshot = s), get snapCalls() { return snapCalls; } };
}

// ─── Тесты ─────────────────────────────────────────────────────────────────

describe('retryDelayMs (порт engine.go:423-435)', () => {
  it('5→10→20→30 мин, потолок 30', () => {
    expect(LIVE_RETRY_BACKOFF_MS).toEqual([5, 10, 20, 30].map((m) => m * 60_000));
    expect(retryDelayMs(1)).toBe(5 * 60_000);
    expect(retryDelayMs(2)).toBe(10 * 60_000);
    expect(retryDelayMs(3)).toBe(20 * 60_000);
    expect(retryDelayMs(4)).toBe(30 * 60_000);
    expect(retryDelayMs(100)).toBe(30 * 60_000);
  });
});

describe('filterContentKey (порт config.go:369-402)', () => {
  it('пустые массивы эквивалентны отсутствующим — ложных перезаписей нет', () => {
    const a = filterContentKey({ thresholdEx: 10, alwaysShow: [] }, 'L', 'content');
    const b = filterContentKey({ thresholdEx: 10 }, 'L', 'content');
    expect(a).toBe(b);
  });

  it('порядок массива не меняет ключ; изменение значения — меняет', () => {
    const a = filterContentKey({ thresholdEx: 10, alwaysShow: ['A', 'B'] }, 'L', 'c');
    const b = filterContentKey({ thresholdEx: 10, alwaysShow: ['B', 'A'] }, 'L', 'c');
    const c = filterContentKey({ thresholdEx: 11, alwaysShow: ['A', 'B'] }, 'L', 'c');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('лига входит в ключ (шапка блока)', () => {
    expect(filterContentKey({ thresholdEx: 10 }, 'L1', 'c')).not.toBe(filterContentKey({ thresholdEx: 10 }, 'L2', 'c'));
  });
});

describe('LiveFilterPipeline.tick (§6.2: cheap-тик, полный run по гейту)', () => {
  it('первый тик: полный run + запись; 3 тика подряд без изменений: 0 дополнительных записей', async () => {
    const h = makePipeline({});
    const { p, writes, clock: clk } = h;
    const r1 = await p.tick();
    expect(r1).toMatchObject({ kind: 'run', wrote: true });
    expect(writes).toHaveLength(1);
    // 3 тика по 30с внутри 4ч-окна: too-early, снапшот даже не запрашивался
    for (let i = 0; i < 3; i++) {
      clk.advance(LIVE_TICK_MS);
      const r = await p.tick();
      expect(r).toMatchObject({ kind: 'idle', reason: 'too-early' });
    }
    expect(writes).toHaveLength(1);
    expect(h.snapCalls).toBe(1);
  });

  it('истечение 4ч → новый полный run; контент НЕ изменился → запись пропущена (диск не тронут)', async () => {
    const h = makePipeline({});
    const { p, writes, clock: clk } = h;
    await p.tick();
    expect(writes).toHaveLength(1);
    clk.advance(LIVE_FULL_RUN_MS);
    const r = await p.tick();
    expect(r).toMatchObject({ kind: 'run', wrote: false }); // тот же ключ — писать нечего
    expect(writes).toHaveLength(1);
    expect(h.snapCalls).toBe(2); // снапшот получен, но диск не тронут — ровно как §6.1
  });

  it('изменение одного значения снапшота → ровно ОДНА новая запись', async () => {
    const { p, writes, clock: clk, setSnapshot } = makePipeline({});
    await p.tick();
    expect(writes).toHaveLength(1);
    clk.advance(LIVE_FULL_RUN_MS);
    setSnapshot(snap('L', 120)); // Divine подешевел
    const r = await p.tick();
    expect(r).toMatchObject({ kind: 'run', wrote: true });
    expect(writes).toHaveLength(2);
    expect(writes[1]).not.toBe(writes[0]);
  });

  it('упавший run: retry-wait по backoff, после успеха fails сброшен', async () => {
    let failing = true;
    const { p, writes, clock: clk } = makePipeline({ getSnapshot: () => (failing ? Promise.reject(new Error('ninja down')) : Promise.resolve(snap('L', 500))) });
    const r1 = await p.tick();
    expect(r1).toMatchObject({ kind: 'error' });
    expect((r1 as { retryAtMs: number }).retryAtMs).toBe(5 * 60_000);
    // тик до истечения backoff — retry-wait, провайдер не дёргается
    clk.advance(30_000);
    expect(await p.tick()).toMatchObject({ kind: 'idle', reason: 'retry-wait' });
    clk.advance(5 * 60_000);
    const r2 = await p.tick();
    expect(r2).toMatchObject({ kind: 'error' }); // всё ещё падает — backoff вырос до 10 мин
    expect((r2 as { retryAtMs: number }).retryAtMs).toBe(5 * 60_000 + 30_000 + 10 * 60_000);
    failing = false;
    clk.advance(10 * 60_000);
    const r3 = await p.tick();
    expect(r3).toMatchObject({ kind: 'run', wrote: true });
    expect(p.getState().fails).toBe(0);
    expect(p.getState().nextRetryAt).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it('cross-run: загруженное состояние (writtenKey) не даёт повторной записи после рестарта', async () => {
    // первый «процесс»
    const first = makePipeline({});
    await first.p.tick();
    const state = first.p.getState();
    // «рестарт»: то же состояние, тот же снапшот
    const second = makePipeline({ state: { ...state } });
    const r = await second.p.tick(); // lastFullRunAt свежий → idle
    expect(r).toMatchObject({ kind: 'idle', reason: 'too-early' });
    second.clock.advance(LIVE_FULL_RUN_MS);
    const r2 = await second.p.tick(); // снапшот тот же → ключ совпал → НЕ пишет
    expect(r2).toMatchObject({ kind: 'run', wrote: false });
    expect(second.writes).toHaveLength(0);
  });

  it('runNow: ручной полный run в обход тайминга (MCP-тул)', async () => {
    const { p, writes } = makePipeline({});
    await p.tick();
    const r = await p.runNow();
    expect(r).toMatchObject({ kind: 'run', wrote: false }); // контент не изменился
    expect(writes).toHaveLength(1);
  });
});

describe('состояние персистится (saveState — engine.go:680-684)', () => {
  it('после записи saveState получил ключ контента; через 4ч — тот же ключ', async () => {
    const saved: PipelineState[] = [];
    const { p, clock: clk } = makePipeline({ onState: (s) => saved.push({ ...s }) });
    await p.tick();
    expect(saved.at(-1)!.writtenKey).toHaveLength(64);
    expect(saved.at(-1)!.lastFullRunAt).toBe(0);
    clk.advance(LIVE_FULL_RUN_MS);
    await p.tick();
    expect(saved.at(-1)!.writtenKey).toBe(saved[0]!.writtenKey);
  });
});

describe('start/stop (тонкая обёртка tick — engine.go:441)', () => {
  it('интервал дёргает tick реально и останавливается', async () => {
    vi.useFakeTimers();
    const { p, writes } = makePipeline({});
    p.start();
    await vi.advanceTimersByTimeAsync(LIVE_TICK_MS); // первый тик (интервал, не t=0)
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3 * LIVE_TICK_MS);
    expect(writes).toHaveLength(1); // в 4ч-окне — idle
    p.stop();
    const before = writes.length;
    await vi.advanceTimersByTimeAsync(10 * LIVE_TICK_MS);
    expect(writes).toHaveLength(before); // таймер снят
    vi.useRealTimers();
  });
});

// ─── Реальный NS: compose внутри pipeline не роняет валидный фильтр ────────

const REAL_NS = fileURLToPath(new URL('../../../../ns_regular_github.filter', import.meta.url));
describe.skipIf(!fs.existsSync(REAL_NS))('pipeline на реальном ns_regular_github.filter', () => {
  it('полный run пишет валидный маркерный файл (tmp-каталог)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3d-'));
    const files: string[] = [];
    const c = clock(0);
    const p = new LiveFilterPipeline({
      getSnapshot: () => Promise.resolve(snap('Forbidden Rites', 765)),
      getBaseContent: () => fs.readFileSync(REAL_NS, 'utf8'),
      config: { thresholdEx: 10, hideLowRarityGear: true },
      write: (content) => { files.push(content); fs.writeFileSync(path.join(dir, 'live.filter'), content, 'utf8'); },
      now: c.now,
    });
    const r = await p.tick();
    expect(r).toMatchObject({ kind: 'run', wrote: true });
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('# [[DYNAMIC LOOT FILTER]]');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
