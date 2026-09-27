import assert from "node:assert/strict";
import test from "node:test";

import { analyzePageviewSeries } from "./pageview-analysis.js";
import type { PageviewItem } from "./wikimedia-pageviews.js";

function monthlyItem(month: number, views: number): PageviewItem {
  return {
    project: "en.wikipedia",
    article: "Astronomy",
    granularity: "monthly",
    timestamp: `2024${month.toString().padStart(2, "0")}0100`,
    access: "all-access",
    agent: "user",
    views,
  };
}

test("normalizes missing periods without converting them to zero", () => {
  const analysis = analyzePageviewSeries({
    items: [monthlyItem(1, 100), monthlyItem(3, 200)],
    start: "2024-01",
    end: "2024-03",
    granularity: "monthly",
    now: new Date("2025-01-01T00:00:00Z"),
  });

  assert.equal(analysis.points.length, 3);
  assert.deepEqual(analysis.points[1], {
    period: "2024-02",
    timestamp: "2024020100",
    views: null,
    missing: true,
  });
  assert.equal(analysis.metrics.missingPoints, 1);
  assert.ok(analysis.warnings.some((warning) => warning.code === "missing-periods"));
});

test("calculates metrics and a strong increasing trend", () => {
  const items = Array.from({ length: 12 }, (_, index) =>
    monthlyItem(index + 1, 100 + index * 10),
  );
  const analysis = analyzePageviewSeries({
    items,
    start: "2024-01",
    end: "2024-12",
    granularity: "monthly",
    now: new Date("2025-01-01T00:00:00Z"),
  });

  assert.equal(analysis.metrics.totalViews, 1860);
  assert.equal(analysis.metrics.averageViews, 155);
  assert.equal(analysis.metrics.firstWindowAverage, 110);
  assert.equal(analysis.metrics.lastWindowAverage, 200);
  assert.equal(analysis.metrics.growthPercent, 81.82);
  assert.equal(analysis.trend.direction, "increasing");
  assert.equal(analysis.trend.slopeViewsPerPeriod, 10);
  assert.equal(analysis.trend.rSquared, 1);
});

test("warns when the current period may be incomplete", () => {
  const analysis = analyzePageviewSeries({
    items: [monthlyItem(9, 100)],
    start: "2024-09",
    end: "2024-09",
    granularity: "monthly",
    now: new Date("2024-09-15T00:00:00Z"),
  });

  assert.ok(
    analysis.warnings.some(
      (warning) => warning.code === "possibly-incomplete-period",
    ),
  );
});
