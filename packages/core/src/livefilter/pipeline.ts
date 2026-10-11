/**
 * Live-price loot filter: цикл 30с-тик / 4ч-полный-run + FilterKey (P3, этап D — №445).
 *
 * Перенос идей из mrw-overlay-poe2 (MIT):
 * Copyright (c) kadircelebi / mrw-overlay-poe2, MIT — FilterKey (config.go:369-402),
 * engine-loop (engine.go:437-471), retry-backoff (engine.go:423-435).
 * Go→TS — переписывание, атрибуция этой строкой.
 *
 * Инварианты донора:
 *  - Тик 30с проверяет ТОЛЬКО cheap-условия (пора ли полный run, не пора ли
 *    ретрай) — никакой генерации/записи вне гейта (engine.go:441-467).
 *  - Полный run не чаще AutoUpdateHours (default 4ч) — снапшот цен живёт час,
 *    но запись дешевле гонять по гейту ключа (§6.2-6.3).
 *  - FilterKey: конфиг нормализуется (app-only поля в содержимое не входят,
 *    пустые list/map эквивалентны отсутствующим — иначе пустые тумблеры
 *    порождают ложные перезаписи, config.go:380-397) → sha256.
 *  - Диск не трогается, если ключ контента не изменился (engine.go:680-684:
 *    writtenKey переживает перезапуск — cross-run-сравнение).
 *  - Упавший run — retry с backoff 5→10→20→30 мин, потолок 30 (engine.go:423-435).
 *
 * Конструкция под тесты: часы/состояние/приёмник записи — инъекция; tick()
 * детерминирован, interval — тонкая обёртка.
 */

import { composeLiveFilter } from './injector.js';
import { HAS_DISK, cryptoMod } from '../nodeenv.js';
import type { LiveFilterConfig, LiveFilterSnapshot } from './rules.js';

export const LIVE_TICK_MS = 30_000;
export const LIVE_FULL_RUN_MS = 4 * 60 * 60 * 1000;
export const LIVE_RETRY_BACKOFF_MS = [5, 10, 20, 30].map((m) => m * 60 * 1000);

export interface LiveFilterPipelineConfig {
  /** Снапшот цен (сеть/кэш — вне pipeline; здесь только контракт). */
  getSnapshot: () => Promise<LiveFilterSnapshot>;
  /** Содержимое базового NS-фильтра (файл/кэш — вне pipeline). */
  getBaseContent: () => string | Promise<string>;
  /** Конфиг генератора (содержимое фильтра). */
  config: LiveFilterConfig;
  /** Приёмник готового контента (инжектор+atomic — у вызывающего). */
  write: (content: string) => void;
  /** Сохранить/загрузить cross-run-состояние (JSON; внеда — in-memory). */
  loadState?: () => PipelineState | null;
  saveState?: (state: PipelineState) => void;
  /** Часы для тестов; по умолчанию Date.now. */
  now?: () => number;
  /** Интервал тика (default 30с — engine.go:441). */
  tickMs?: number;
  /** Полный run не чаще (default 4ч — engine.go:463-467). */
  fullRunMs?: number;
}

export interface PipelineState {
  /** sha256 последнего ЗАПИСАННОГО контента (cross-run, engine.go:680-684). */
  writtenKey: string | null;
  /** Момент последнего полного run (мс). */
  lastFullRunAt: number | null;
  /** Число упавших run подряд. */
  fails: number;
  /** Момент, когда ретрай разблокирован (backoff). */
  nextRetryAt: number | null;
}

export type TickResult =
  | { kind: 'idle'; reason: 'too-early' | 'retry-wait' }
  | { kind: 'run'; wrote: boolean; key: string }
  | { kind: 'error'; error: unknown; retryAtMs: number };

/**
 * FilterKey-нормализация конфига (config.go:380-397): только поля, влияющие
 * на содержимое фильтра; undefined/пустые-массивы эквивалентны отсутствующим;
 * стабильный порядок ключей. league входит (терм of содержимого: шапка блока).
 */
export function filterContentKey(config: LiveFilterConfig, league: string, content: string): string {
  const norm: Record<string, unknown> = { league };
  const entries = Object.entries(config).filter(([k]) => k in DEFAULT_CONFIG_KEYS);
  for (const [k, v] of entries) {
    if (v === undefined) continue; // отсутствует
    if (Array.isArray(v) && v.length === 0) continue; // [] == отсутствует (config.go:390-397)
    norm[k] = Array.isArray(v) ? [...v].sort() : v;
  }
  const canon = JSON.stringify(norm) + '\u0000' + content;
  return cryptoMod!.createHash('sha256').update(canon).digest('hex');
}

const DEFAULT_CONFIG_KEYS: Record<string, true> = {
  thresholdEx: true, alwaysShow: true, uncutGemMinLevel: true,
  waystoneMinTier: true, hideLowRarityGear: true,
};

function initialState(now: number): PipelineState {
  return { writtenKey: null, lastFullRunAt: null, fails: 0, nextRetryAt: null };
}

/** Ретрай-задержка: 5→10→20→30 мин, потолок (engine.go:423-435). */
export function retryDelayMs(fails: number): number {
  const i = Math.min(Math.max(fails - 1, 0), LIVE_RETRY_BACKOFF_MS.length - 1);
  return LIVE_RETRY_BACKOFF_MS[i];
}

export class LiveFilterPipeline {
  private readonly cfg: LiveFilterPipelineConfig;
  private state: PipelineState;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(cfg: LiveFilterPipelineConfig) {
    if (!HAS_DISK || !cryptoMod) {
      throw new Error('livefilter: pipeline требует Node (sha256/диск)');
    }
    this.cfg = cfg;
    this.now = cfg.now ?? Date.now;
    const loaded = cfg.loadState?.() ?? null;
    this.state = loaded ?? initialState(this.now());
  }

  getState(): Readonly<PipelineState> {
    return this.state;
  }

  /** Одно cheap-решение тика. Реентерабельность: run не параллелится. */
  async tick(): Promise<TickResult> {
    const now = this.now();
    const { lastFullRunAt, nextRetryAt } = this.state;
    if (nextRetryAt !== null && now < nextRetryAt) {
      return { kind: 'idle', reason: 'retry-wait' };
    }
    const fullRunMs = this.cfg.fullRunMs ?? LIVE_FULL_RUN_MS;
    if (this.inFlight) return { kind: 'idle', reason: 'too-early' };
    if (
      lastFullRunAt !== null &&
      now - lastFullRunAt < fullRunMs &&
      this.state.writtenKey !== null
    ) {
      return { kind: 'idle', reason: 'too-early' };
    }
    this.inFlight = true;
    try {
      const res = await this.run(now);
      return res;
    } finally {
      this.inFlight = false;
    }
  }

  private async run(now: number): Promise<TickResult> {
    let snapshot: LiveFilterSnapshot;
    let base: string;
    try {
      [snapshot, base] = await Promise.all([this.cfg.getSnapshot(), this.cfg.getBaseContent()]);
    } catch (error) {
      this.state.fails++;
      const retryAtMs = now + retryDelayMs(this.state.fails);
      this.state.nextRetryAt = retryAtMs;
      this.persist();
      return { kind: 'error', error, retryAtMs };
    }
    const composed = composeLiveFilter(base, snapshot, this.cfg.config);
    const key = filterContentKey(this.cfg.config, snapshot.league, composed.content);
    let wrote = false;
    // Диск не трогается без изменений контента (config.go:369-372)
    if (key !== this.state.writtenKey) {
      this.cfg.write(composed.content);
      wrote = true;
    }
    this.state = {
      writtenKey: key,
      lastFullRunAt: now,
      fails: 0,
      nextRetryAt: null,
    };
    this.persist();
    return { kind: 'run', wrote, key };
  }

  /** Принудительный полный run, минуя тайминг (ручной триггер/MCP-тул). */
  async runNow(): Promise<TickResult> {
    if (this.inFlight) return { kind: 'idle', reason: 'too-early' };
    this.inFlight = true;
    try {
      return await this.run(this.now());
    } finally {
      this.inFlight = false;
    }
  }

  /** Запуск таймера (тонкая обёртка tick — engine.go:441). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.cfg.tickMs ?? LIVE_TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private persist(): void {
    this.cfg.saveState?.(this.state);
  }
}
