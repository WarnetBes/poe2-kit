/**
 * Анализ рынка: тренд, волатильность, объёмы, выбросы, торговые сигналы.
 *
 * Чистая офлайн-логика: на вход — массив логов цен (цена/время/объём),
 * на выходе — структурный вердикт. Сеть не нужна, работает в web/overlay/MCP.
 *
 * Происхождение формул: poe2scout-mcp (MIT-license, Copyright (c) 2025
 * Ran Aroussi — `_research/poe2scout-mcp-main/src/analysis/priceAnalysis.ts`),
 * портировано с адаптацией под наши типы и RU-строки; поведение пороговых
 * значений сохранено (CV<0.1 low / <0.3 medium; outlier: |Δ|>50% + объём<10;
 * spike: объём > 3× среднего). MIT-условие: уведомление о лицензии сохранено.
 */

/** Одна точка истории цен (часовой лог poe2scout Items/{id}/History). */
export interface PriceLog {
  price: number;
  time: string;
  quantity: number;
}

/** Дневная свеча (poe2scout DailyStatsHistory). */
export interface DailyStat {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  average: number;
  volume: number;
}

export type TrendDirection = 'rising' | 'falling' | 'stable';
export type TrendStrength = 'weak' | 'moderate' | 'strong';
export type Level3 = 'low' | 'medium' | 'high';
export type VolumeLevel = 'low' | 'normal' | 'high';
export type Rec = 'buy' | 'sell' | 'hold' | 'fair_value';
export type Confidence = 'low' | 'medium' | 'high';

export interface DailyTrend {
  /** Изменение close за всё окно, %. null — меньше 2 точек. */
  changePct: number | null;
  /** Средний дневной объём trades (объём poe2scout — единицы базовой валюты). */
  avgVolume: number | null;
  /** Динамика объёма: последний/среднее, null — нет данных. */
  volumeTrend: number | null;
  /** Простая линейная оценка наклона (%/день, по close). null — <2 точек. */
  slopePctPerDay: number | null;
}

export interface PriceAnalysis {
  item: string;
  currentPrice: number | null;
  priceAnalysis: {
    trend: TrendDirection;
    trendStrength: TrendStrength;
    volatility: Level3;
    confidence: Confidence;
    volumeLevel: VolumeLevel;
    priceRange: { min: number; max: number; avg: number };
    recommendation: Rec;
    riskLevel: Level3;
  };
  tradingSignals: {
    buySignal: 'strong' | 'weak' | 'neutral';
    sellSignal: 'strong' | 'weak' | 'neutral';
    holdRecommendation: 'yes' | 'no';
  };
  marketContext: {
    recentVolumeSpike: boolean;
    priceStability: number; // 0..1
    outlierDetected: boolean;
    outlierPrice: number | null;
    dataPoints: number;
  };
  dailyTrend: DailyTrend;
  insights: string[];
}

/**
 * Полный анализ часовых логов цен.
 * Логи могут идти в любом порядке и содержать null-ы — фильтруются.
 */
export function analyzePrices(item: string, logs: Array<PriceLog | null | undefined>): PriceAnalysis {
  const valid = (logs ?? []).filter((l): l is PriceLog => !!l && Number.isFinite(l.price));
  const sorted = [...valid].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const current = sorted[0]?.price ?? null;

  if (sorted.length === 0 || current == null) {
    return emptyAnalysis(item);
  }

  const prices = sorted.map((l) => l.price);
  const volumes = sorted.map((l) => l.quantity);

  const priceStats = calcRange(prices);
  const volatility = calcVolatility(prices);
  const trend = calcTrend(prices);
  const volume = analyzeVolume(volumes);
  const outlier = detectOutlier(prices, volumes);

  return {
    item,
    currentPrice: current,
    priceAnalysis: {
      trend: trend.direction,
      trendStrength: trend.strength,
      volatility: volatility.level,
      confidence: calcConfidence(sorted.length, volatility.level, volume.level),
      volumeLevel: volume.level,
      priceRange: priceStats,
      recommendation: calcRecommendation(current, priceStats, trend.direction),
      riskLevel: calcRisk(volatility.level, trend.strength),
    },
    tradingSignals: calcSignals(current, prices, trend, volatility),
    marketContext: {
      recentVolumeSpike: volume.spike,
      priceStability: 1 - volatility.score,
      outlierDetected: outlier.detected,
      outlierPrice: outlier.price,
      dataPoints: sorted.length,
    },
    dailyTrend: analyzeDailyTrend([]),
    insights: buildInsights(item, current, priceStats, trend, volatility, outlier),
  };
}

/**
 * Дневной тренд по свечам OHLC (poe2scout DailyStatsHistory).
 * Независим от часовых логов: можно звать отдельно.
 */
export function analyzeDailyTrend(days: DailyStat[]): DailyTrend {
  const valid = (days ?? []).filter(
    (d) => d && Number.isFinite(d.close) && Number.isFinite(d.volume),
  );
  if (valid.length === 0) return { changePct: null, avgVolume: null, volumeTrend: null, slopePctPerDay: null };

  const asc = [...valid].sort((a, b) => a.time.localeCompare(b.time));
  const first = asc[0];
  const last = asc[asc.length - 1];
  const changePct = first.close !== 0 ? ((last.close - first.close) / first.close) * 100 : null;

  const avgVolume = asc.reduce((s, d) => s + d.volume, 0) / asc.length;
  const volumeTrend = avgVolume > 0 ? last.volume / avgVolume : null;

  // Наклон по МНК close(x) по индексам дней, %/день от первой цены.
  let slopePctPerDay: number | null = null;
  if (asc.length >= 2 && first.close !== 0) {
    const n = asc.length;
    const meanX = (n - 1) / 2;
    const meanY = asc.reduce((s, d) => s + d.close, 0) / n;
    let num = 0;
    let den = 0;
    asc.forEach((d, i) => {
      num += (i - meanX) * (d.close - meanY);
      den += (i - meanX) * (i - meanX);
    });
    const slope = den !== 0 ? num / den : 0;
    slopePctPerDay = (slope / first.close) * 100;
  }

  return { changePct, avgVolume, volumeTrend, slopePctPerDay };
}

/** Комбинированный анализ: часовые логи + дневные свечи одним вердиктом. */
export function analyzePricesFull(
  item: string,
  logs: Array<PriceLog | null | undefined>,
  daily: DailyStat[],
): PriceAnalysis {
  const base = analyzePrices(item, logs);
  const dt = analyzeDailyTrend(daily);
  base.dailyTrend = dt;
  if (dt.changePct != null) {
    const dir = dt.changePct > 5 ? 'растёт' : dt.changePct < -5 ? 'падает' : 'стабилен';
    base.insights.push(`За окно дней цена ${dir} (${dt.changePct.toFixed(1)}%).`);
  }
  if (dt.volumeTrend != null && dt.volumeTrend < 0.5) {
    base.insights.push(
      `Объём торгов просел до ${(dt.volumeTrend * 100).toFixed(0)}% от среднего — цена может быть нерепрезентативной (⚠ риск манипуляций при низком объёме).`,
    );
  }
  return base;
}

// ── внутренние (пороги — канон донора poe2scout-mcp, см. шапку) ──

function emptyAnalysis(item: string): PriceAnalysis {
  return {
    item,
    currentPrice: null,
    priceAnalysis: {
      trend: 'stable',
      trendStrength: 'weak',
      volatility: 'low',
      confidence: 'low',
      volumeLevel: 'low',
      priceRange: { min: 0, max: 0, avg: 0 },
      recommendation: 'hold',
      riskLevel: 'high',
    },
    tradingSignals: { buySignal: 'neutral', sellSignal: 'neutral', holdRecommendation: 'yes' },
    marketContext: {
      recentVolumeSpike: false,
      priceStability: 0,
      outlierDetected: false,
      outlierPrice: null,
      dataPoints: 0,
    },
    dailyTrend: { changePct: null, avgVolume: null, volumeTrend: null, slopePctPerDay: null },
    insights: ['Недостаточно данных истории для надёжного анализа.'],
  };
}

function calcRange(prices: number[]): { min: number; max: number; avg: number } {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  return { min, max, avg };
}

function calcVolatility(prices: number[]): { level: Level3; score: number } {
  if (prices.length < 2) return { level: 'low', score: 0 };
  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  if (mean === 0) return { level: 'low', score: 0 };
  const variance = prices.reduce((s, p) => s + (p - mean) * (p - mean), 0) / prices.length;
  const cv = Math.sqrt(variance) / mean;
  const level: Level3 = cv < 0.1 ? 'low' : cv < 0.3 ? 'medium' : 'high';
  return { level, score: Math.min(cv, 1) };
}

function calcTrend(prices: number[]): { direction: TrendDirection; strength: TrendStrength } {
  if (prices.length < 3) return { direction: 'stable', strength: 'weak' };
  const recent = prices.slice(0, Math.min(5, prices.length));
  const oldest = recent[recent.length - 1];
  const newest = recent[0];
  if (!oldest || !newest) return { direction: 'stable', strength: 'weak' };
  const pct = ((newest - oldest) / oldest) * 100;
  const direction: TrendDirection = Math.abs(pct) < 5 ? 'stable' : pct > 0 ? 'rising' : 'falling';
  const abs = Math.abs(pct);
  const strength: TrendStrength = abs < 10 ? 'weak' : abs < 25 ? 'moderate' : 'strong';
  return { direction, strength };
}

function analyzeVolume(volumes: number[]): { level: VolumeLevel; spike: boolean } {
  if (volumes.length === 0) return { level: 'low', spike: false };
  const total = volumes.reduce((s, v) => s + v, 0);
  const avg = total / volumes.length;
  const spike = (volumes[0] ?? 0) > avg * 3;
  const level: VolumeLevel = avg < 100 ? 'low' : avg < 1000 ? 'normal' : 'high';
  return { level, spike };
}

function detectOutlier(prices: number[], volumes: number[]): { detected: boolean; price: number | null } {
  if (prices.length < 3) return { detected: false, price: null };
  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  if (mean === 0) return { detected: false, price: null };
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const volume = volumes[i] ?? 0;
    const deviation = Math.abs((price - mean) / mean);
    if (deviation > 0.5 && volume < 10) {
      return { detected: true, price };
    }
  }
  return { detected: false, price: null };
}

function calcSignals(
  currentPrice: number,
  prices: number[],
  trend: { direction: TrendDirection; strength: TrendStrength },
  volatility: { level: Level3 },
) {
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  const vsAvg = avg !== 0 ? (currentPrice - avg) / avg : 0;

  let buySignal: 'strong' | 'weak' | 'neutral' = 'neutral';
  let sellSignal: 'strong' | 'weak' | 'neutral' = 'neutral';

  if (vsAvg < -0.15 && trend.direction === 'rising') buySignal = 'strong';
  else if (vsAvg < -0.1 || (trend.direction === 'rising' && trend.strength === 'strong')) buySignal = 'weak';

  if (vsAvg > 0.15 && trend.direction === 'falling') sellSignal = 'strong';
  else if (vsAvg > 0.1 || (trend.direction === 'falling' && trend.strength === 'strong')) sellSignal = 'weak';

  const holdRecommendation: 'yes' | 'no' =
    volatility.level === 'high' || trend.direction === 'stable' || (buySignal === 'neutral' && sellSignal === 'neutral')
      ? 'yes'
      : 'no';

  return { buySignal, sellSignal, holdRecommendation };
}

function calcConfidence(points: number, volatility: Level3, volumeLevel: VolumeLevel): Confidence {
  let score = 0;
  score += points >= 5 ? 3 : points >= 3 ? 2 : 1;
  score += volatility === 'low' ? 3 : volatility === 'medium' ? 2 : 1;
  score += volumeLevel === 'high' ? 3 : volumeLevel === 'normal' ? 2 : 1;
  if (score >= 7) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

function calcRecommendation(
  currentPrice: number,
  stats: { avg: number },
  trend: TrendDirection,
): Rec {
  if (stats.avg === 0) return 'hold';
  const vsAvg = (currentPrice - stats.avg) / stats.avg;
  if (Math.abs(vsAvg) < 0.05) return 'fair_value';
  if (vsAvg < -0.1 && trend !== 'falling') return 'buy';
  if (vsAvg > 0.1 && trend !== 'rising') return 'sell';
  return 'hold';
}

function calcRisk(volatility: Level3, strength: TrendStrength): Level3 {
  if (volatility === 'high' || strength === 'strong') return 'high';
  if (volatility === 'medium' || strength === 'moderate') return 'medium';
  return 'low';
}

function buildInsights(
  _item: string,
  currentPrice: number,
  stats: { min: number; max: number; avg: number },
  trend: { direction: TrendDirection; strength: TrendStrength },
  volatility: { level: Level3 },
  outlier: { detected: boolean; price: number | null },
): string[] {
  const insights: string[] = [];
  if (stats.avg !== 0) {
    const vsAvg = ((currentPrice - stats.avg) / stats.avg) * 100;
    if (Math.abs(vsAvg) > 10) {
      const dir = vsAvg > 0 ? 'выше' : 'ниже';
      insights.push(`Текущая цена на ${Math.abs(vsAvg).toFixed(1)}% ${dir} среднего за окно.`);
    } else {
      insights.push('Цена около среднего за окно — справедливая стоимость.');
    }
  }
  if (trend.direction !== 'stable') {
    const dir = trend.direction === 'rising' ? 'рост' : 'падение';
    insights.push(`Обнаружен ${dir} (${trend.strength}).`);
  }
  if (volatility.level === 'high') insights.push('Высокая волатильность — ждите сильных колебаний.');
  else if (volatility.level === 'low') insights.push('Низкая волатильность — цена предсказуема.');
  if (outlier.detected && outlier.price != null) {
    insights.push(`Выброс: точка ${outlier.price} (вероятно аномалия/манипуляция — не ориентируйтесь на неё).`);
  }
  return insights;
}
