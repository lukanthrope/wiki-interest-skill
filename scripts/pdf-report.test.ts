import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { createPdfReport, type ReportAnalysis } from "./pdf-report.js";

test("exports complete Markdown content and analysis data to PDF", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wiki-interest-pdf-"));
  const outputPath = join(directory, "report.pdf");
  const analysis: ReportAnalysis = {
    request: { start: "2024-01", end: "2024-12", granularity: "monthly" },
    topics: [
      {
        id: "astronomy",
        label: "Астрономія",
        series: [
          {
            language: "uk",
            article: "Астрономія",
            project: "uk.wikipedia.org",
            metrics: {
              expectedPoints: 12,
              observedPoints: 12,
              missingPoints: 0,
              totalViews: 1200,
              averageViews: 100,
              medianViews: 95,
              minimumViews: 80,
              maximumViews: 125,
              firstWindowAverage: 90,
              lastWindowAverage: 110,
              growthPercent: 22.22,
              volatility: 0.12,
            },
            trend: {
              direction: "increasing",
              slopeViewsPerPeriod: 2,
              predictedChangePercent: 22,
              rSquared: 0.8,
            },
            warnings: [],
          },
        ],
      },
    ],
  };

  await createPdfReport({
    outputPath,
    title: "Звіт про інтерес",
    markdownSections: [
      {
        source: "response.md",
        markdown: "# Висновок\n\nПопит **зростає**.\n\n- Перший результат\n- Другий результат",
      },
    ],
    analyses: [{ source: "analysis.json", directory, value: analysis }],
  });

  const pdf = await readFile(outputPath);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 4_000);
});
