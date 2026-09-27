import assert from "node:assert/strict";
import test from "node:test";

import { analyzePageviewSeries } from "./pageview-analysis.js";
import { renderTopicChart } from "./visualization.js";

test("renders an SVG chart and escapes user-controlled labels", () => {
  const analysis = analyzePageviewSeries({
    items: [
      {
        project: "en.wikipedia",
        article: "A&B",
        granularity: "monthly",
        timestamp: "2024010100",
        access: "all-access",
        agent: "user",
        views: 100,
      },
      {
        project: "en.wikipedia",
        article: "A&B",
        granularity: "monthly",
        timestamp: "2024020100",
        access: "all-access",
        agent: "user",
        views: 150,
      },
    ],
    start: "2024-01",
    end: "2024-02",
    granularity: "monthly",
    now: new Date("2025-01-01T00:00:00Z"),
  });
  const svg = renderTopicChart({
    title: "Research <topic>",
    series: [{ label: "en: A&B", analysis }],
  });

  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<polyline/);
  assert.match(svg, /Research &lt;topic&gt;/);
  assert.match(svg, /en: A&amp;B/);
});
