import type {
  PageviewItem,
  PageviewsGranularity,
} from "./wikimedia-pageviews.js";

export type NormalizedPoint = {
  period: string;
  timestamp: string;
  views: number | null;
  missing: boolean;
};

export type AnalysisWarning = {
  code: string;
  severity: "info" | "warning";
  message: string;
};

export type SeriesMetrics = {
  expectedPoints: number;
  observedPoints: number;
  missingPoints: number;
  totalViews: number;
  averageViews: number | null;
  medianViews: number | null;
  minimumViews: number | null;
  maximumViews: number | null;
  firstWindowAverage: number | null;
  lastWindowAverage: number | null;
  growthPercent: number | null;
  volatility: number | null;
};

export type TrendAnalysis = {
  direction: "increasing" | "decreasing" | "stable" | "unknown";
  slopeViewsPerPeriod: number | null;
  predictedChangePercent: number | null;
  rSquared: number | null;
};

export type AnalyzedSeries = {
  points: NormalizedPoint[];
  metrics: SeriesMetrics;
  trend: TrendAnalysis;
  warnings: AnalysisWarning[];
};

export type AnalyzeSeriesOptions = {
  items: PageviewItem[];
  start: string;
  end: string;
  granularity: PageviewsGranularity;
  now?: Date;
};

export function analyzePageviewSeries(
  options: AnalyzeSeriesOptions,
): AnalyzedSeries {
  const periods = buildPeriods(options.start, options.end, options.granularity);
  const itemByPeriod = new Map(
    options.items.map((item) => [timestampToPeriod(item.timestamp, options.granularity), item]),
  );
  const points = periods.map<NormalizedPoint>((period) => {
    const item = itemByPeriod.get(period);
    return {
      period,
      timestamp: item?.timestamp ?? periodToTimestamp(period, options.granularity),
      views: item?.views ?? null,
      missing: item === undefined,
    };
  });

  const observed = points.filter(
    (point): point is NormalizedPoint & { views: number } => point.views !== null,
  );
  const values = observed.map((point) => point.views);
  const totalViews = values.reduce((sum, value) => sum + value, 0);
  const averageViews = values.length > 0 ? totalViews / values.length : null;
  const medianViews = median(values);
  const windowSize = Math.min(3, points.length);
  const firstWindowAverage = averageNonNull(points.slice(0, windowSize));
  const lastWindowAverage = averageNonNull(points.slice(-windowSize));
  const growthPercent = percentageChange(firstWindowAverage, lastWindowAverage);
  const volatility = coefficientOfVariation(values, averageViews);
  const trend = calculateTrend(points, averageViews);

  const metrics: SeriesMetrics = {
    expectedPoints: points.length,
    observedPoints: observed.length,
    missingPoints: points.length - observed.length,
    totalViews,
    averageViews: round(averageViews),
    medianViews: round(medianViews),
    minimumViews: values.length > 0 ? Math.min(...values) : null,
    maximumViews: values.length > 0 ? Math.max(...values) : null,
    firstWindowAverage: round(firstWindowAverage),
    lastWindowAverage: round(lastWindowAverage),
    growthPercent: round(growthPercent),
    volatility: round(volatility),
  };

  return {
    points,
    metrics,
    trend,
    warnings: buildWarnings({
      points,
      values,
      medianViews,
      volatility,
      trend,
      granularity: options.granularity,
      end: options.end,
      now: options.now ?? new Date(),
    }),
  };
}

function calculateTrend(
  points: NormalizedPoint[],
  averageViews: number | null,
): TrendAnalysis {
  const samples = points
    .map((point, index) => ({ x: index, y: point.views }))
    .filter((sample): sample is { x: number; y: number } => sample.y !== null);

  if (samples.length < 2 || averageViews === null || averageViews === 0) {
    return {
      direction: "unknown",
      slopeViewsPerPeriod: null,
      predictedChangePercent: null,
      rSquared: null,
    };
  }

  const meanX = average(samples.map((sample) => sample.x)) ?? 0;
  const meanY = average(samples.map((sample) => sample.y)) ?? 0;
  const numerator = samples.reduce(
    (sum, sample) => sum + (sample.x - meanX) * (sample.y - meanY),
    0,
  );
  const denominator = samples.reduce(
    (sum, sample) => sum + (sample.x - meanX) ** 2,
    0,
  );
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  const totalVariation = samples.reduce(
    (sum, sample) => sum + (sample.y - meanY) ** 2,
    0,
  );
  const residualVariation = samples.reduce(
    (sum, sample) => sum + (sample.y - (intercept + slope * sample.x)) ** 2,
    0,
  );
  const rSquared =
    totalVariation === 0 ? 1 : 1 - residualVariation / totalVariation;
  const predictedChangePercent =
    (slope * (points.length - 1) * 100) / averageViews;
  const direction =
    predictedChangePercent > 5
      ? "increasing"
      : predictedChangePercent < -5
        ? "decreasing"
        : "stable";

  return {
    direction,
    slopeViewsPerPeriod: round(slope),
    predictedChangePercent: round(predictedChangePercent),
    rSquared: round(Math.max(0, Math.min(1, rSquared))),
  };
}

function buildWarnings(options: {
  points: NormalizedPoint[];
  values: number[];
  medianViews: number | null;
  volatility: number | null;
  trend: TrendAnalysis;
  granularity: PageviewsGranularity;
  end: string;
  now: Date;
}): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];
  const missing = options.points.filter((point) => point.missing).length;

  if (missing > 0) {
    warnings.push({
      code: "missing-periods",
      severity: "warning",
      message:
        `${missing} of ${options.points.length} expected periods are missing. ` +
        "Wikimedia can omit zero or unavailable values, so they were kept as null.",
    });
  }

  const recommendedMinimum = options.granularity === "monthly" ? 12 : 30;
  if (options.points.length < recommendedMinimum) {
    warnings.push({
      code: "short-history",
      severity: "warning",
      message: `Only ${options.points.length} periods were requested; trend estimates may be unstable.`,
    });
  }

  if (options.volatility !== null && options.volatility > 0.5) {
    warnings.push({
      code: "high-volatility",
      severity: "warning",
      message: "Page views vary substantially between periods; avoid relying on endpoints alone.",
    });
  }

  if (
    options.medianViews !== null &&
    options.medianViews > 0 &&
    options.values.some((value) => value > options.medianViews! * 3)
  ) {
    warnings.push({
      code: "traffic-spike",
      severity: "warning",
      message: "At least one period exceeds three times the median and may represent a temporary event.",
    });
  }

  if (
    options.trend.direction !== "unknown" &&
    options.trend.direction !== "stable" &&
    options.trend.rSquared !== null &&
    options.trend.rSquared < 0.3
  ) {
    warnings.push({
      code: "weak-linear-trend",
      severity: "warning",
      message: "The linear trend explains less than 30% of the variation in page views.",
    });
  }

  if (includesCurrentPeriod(options.end, options.granularity, options.now)) {
    warnings.push({
      code: "possibly-incomplete-period",
      severity: "info",
      message: "The requested range includes the current period, which may not be complete yet.",
    });
  }

  return warnings;
}

function buildPeriods(
  start: string,
  end: string,
  granularity: PageviewsGranularity,
): string[] {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const periods: string[] = [];
  const cursor = new Date(startDate);

  if (granularity === "monthly") cursor.setUTCDate(1);
  while (cursor <= endDate) {
    periods.push(formatPeriod(cursor, granularity));
    if (granularity === "monthly") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return periods;
}

function parseDate(value: string): Date {
  const match = /^(\d{4})(?:-?)(\d{2})(?:(?:-?)(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`Invalid analysis date "${value}".`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? 1)));
}

function timestampToPeriod(
  timestamp: string,
  granularity: PageviewsGranularity,
): string {
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  return granularity === "monthly" ? `${year}-${month}` : `${year}-${month}-${day}`;
}

function periodToTimestamp(
  period: string,
  granularity: PageviewsGranularity,
): string {
  return `${period.replaceAll("-", "")}${granularity === "monthly" ? "01" : ""}00`;
}

function formatPeriod(date: Date, granularity: PageviewsGranularity): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return granularity === "monthly" ? `${year}-${month}` : `${year}-${month}-${day}`;
}

function includesCurrentPeriod(
  end: string,
  granularity: PageviewsGranularity,
  now: Date,
): boolean {
  return formatPeriod(parseDate(end), granularity) >= formatPeriod(now, granularity);
}

function average(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function averageNonNull(points: NormalizedPoint[]): number | null {
  return average(
    points.flatMap((point) => (point.views === null ? [] : [point.views])),
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

function percentageChange(
  from: number | null,
  to: number | null,
): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

function coefficientOfVariation(
  values: number[],
  mean: number | null,
): number | null {
  if (values.length < 2 || mean === null || mean === 0) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance) / mean;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
