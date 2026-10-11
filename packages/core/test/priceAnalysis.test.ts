import { describe, expect, it } from 'vitest';
import {
  analyzePrices,
  analyzeDailyTrend,
  analyzePricesFull,
  type PriceLog,
  type DailyStat,
} from '../src/priceAnalysis.js';

/** Детерминированные фикстуры: часовые точки (hoursAgo: 0 = самая новая). */
function log(price: number, hoursAgo: number, quantity = 50): PriceLog {
  return { price, time: new Date(Date.UTC(2026, 9, 11, 12 - hoursAgo)).toISOString(), quantity };
}

const stable: PriceLog[] = [
  log(10, 0), log(10.2, 1), log(9.9, 2), log(10.1, 3), log(10, 4), log(9.8, 5), log(10.1, 6),
];

describe('analyzePrices', () => {
  it('пустой вход → честный пустой вердикт', () => {
    const a = analyzePrices('Divine Orb', []);
    expect(a.currentPrice).toBeNull();
    expect(a.priceAnalysis.recommendation).toBe('hold');
    expect(a.marketContext.dataPoints).toBe(0);
    expect(a.insights.join()).toContain('Недостаточно');
  });

  it('null-точки отфильтрованы', () => {
    const a = analyzePrices('X', [null, ...stable]);
    expect(a.marketContext.dataPoints).toBe(stable.length);
    expect(a.currentPrice).toBe(10);
  });

  it('стабильная цена → fair_value, low volatility, hold', () => {
    const a = analyzePrices('Exalted Orb', stable);
    expect(a.priceAnalysis.trend).toBe('stable');
    expect(a.priceAnalysis.volatility).toBe('low');
    expect(a.priceAnalysis.recommendation).toBe('fair_value');
    expect(a.tradingSignals.holdRecommendation).toBe('yes');
    expect(a.priceAnalysis.confidence).toBe('high'); // 7 точек, low vol, объём 50<100 → low… см. ниже
  });

  it('strong buy: current ниже среднего >15%, импульс rising >5%', () => {
    // recent-5: 105→100 (рост +5% → rising); старые выбросы 240..260 тянут среднее ≈157.6.
    const logs: PriceLog[] = [
      log(105, 0), log(103, 1), log(102, 2), log(101, 3), log(100, 4),
      log(260, 5, 40), log(250, 6, 40), log(240, 7, 40),
    ];
    const a = analyzePrices('Divine Orb', logs);
    expect(a.tradingSignals.buySignal).toBe('strong');
  });

  it('weak sell: current выше среднего на >10%', () => {
    const logs: PriceLog[] = [
      log(120, 0), log(100, 1), log(101, 2), log(100, 3), log(99, 4), log(100, 5), log(100, 6),
    ];
    const a = analyzePrices('Divine Orb', logs);
    // avg ≈ 102.86, current 120 → +16.6% > 10% → weak sell
    expect(a.tradingSignals.sellSignal).toBe('weak');
  });

  it('выброс: отклонение>50% при объёме<10', () => {
    const logs: PriceLog[] = [
      log(10, 0), log(10, 1), log(10, 2), log(100, 3, 3), log(10, 4), log(10, 5),
    ];
    const a = analyzePrices('X', logs);
    expect(a.marketContext.outlierDetected).toBe(true);
    expect(a.marketContext.outlierPrice).toBe(100);
  });

  it('высокая волатильность → riskLevel high, holdRecommendation yes', () => {
    const logs: PriceLog[] = [
      log(50, 0), log(100, 1), log(10, 2), log(90, 3), log(20, 4), log(70, 5),
    ];
    const a = analyzePrices('X', logs);
    expect(a.priceAnalysis.volatility).toBe('high');
    expect(a.priceAnalysis.riskLevel).toBe('high');
    expect(a.tradingSignals.holdRecommendation).toBe('yes');
  });

  it('объём: свежий всплеск >3× среднего детектируется', () => {
    const logs: PriceLog[] = [
      log(10, 0, 1000), log(10, 1, 100), log(10, 2, 100), log(10, 3, 100), log(10, 4, 100),
    ];
    const a = analyzePrices('X', logs);
    expect(a.marketContext.recentVolumeSpike).toBe(true);
  });

  it('мало точек + высокая волатильность → confidence low', () => {
    // score: points 3 → +2; volatility high → +1; объём низкий → +1 = 4 → low.
    const a = analyzePrices('X', [log(10, 0, 1), log(500, 1, 1), log(10, 2, 1)]);
    expect(a.priceAnalysis.confidence).toBe('low');
  });
});

describe('analyzeDailyTrend', () => {
  const day = (t: string, close: number, volume = 1000): DailyStat => ({
    time: t, open: close, high: close, low: close, close, average: close, volume,
  });

  it('рост +10%/день: changePct=+21%, положительный наклон', () => {
    const dt = analyzeDailyTrend([
      day('2026-10-01', 100), day('2026-10-02', 110), day('2026-10-03', 121),
    ]);
    expect(dt.changePct).toBeCloseTo(21, 0);
    expect(dt.slopePctPerDay).toBeGreaterThan(0);
    expect(dt.avgVolume).toBe(1000);
    expect(dt.volumeTrend).toBe(1);
  });

  it('пустой вход → все поля null; одна точка → changePct=0', () => {
    const dt = analyzeDailyTrend([]);
    expect(dt.changePct).toBeNull();
    expect(dt.slopePctPerDay).toBeNull();
    const one = analyzeDailyTrend([day('2026-10-01', 5)]);
    expect(one.changePct).toBe(0);
    expect(one.slopePctPerDay).toBeNull();
  });

  it('просадка объёма последнего дня <50% среднего фиксируется', () => {
    const dt = analyzeDailyTrend([
      day('2026-10-01', 10, 1000), day('2026-10-02', 10, 1000), day('2026-10-03', 10, 300),
    ]);
    expect(dt.volumeTrend).toBeLessThan(0.5);
  });
});

describe('analyzePricesFull', () => {
  it('объединяет часовые и дневные данные, добавляет дневной инсайт', () => {
    const days: DailyStat[] = [
      { time: '2026-10-01', open: 100, high: 105, low: 95, close: 100, average: 100, volume: 1000 },
      { time: '2026-10-02', open: 100, high: 110, low: 95, close: 120, average: 105, volume: 900 },
    ];
    const a = analyzePricesFull('Divine Orb', stable, days);
    expect(a.dailyTrend.changePct).toBeCloseTo(20, 0);
    expect(a.insights.some((s) => s.includes('растёт'))).toBe(true);
  });
});
