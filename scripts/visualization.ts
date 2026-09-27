import type { AnalyzedSeries } from "./pageview-analysis.js";

export type ChartSeries = {
  label: string;
  analysis: AnalyzedSeries;
};

const COLORS = ["#2563eb", "#dc2626", "#059669", "#9333ea", "#ea580c"];

export function renderTopicChart(options: {
  title: string;
  series: ChartSeries[];
  width?: number;
  height?: number;
}): string {
  const width = options.width ?? 1000;
  const height = options.height ?? 560;
  const margin = { top: 72, right: 40, bottom: 72, left: 88 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const pointCount = Math.max(
    1,
    ...options.series.map((entry) => entry.analysis.points.length),
  );
  const maximum = Math.max(
    1,
    ...options.series.flatMap((entry) =>
      entry.analysis.points.flatMap((point) =>
        point.views === null ? [] : [point.views],
      ),
    ),
  );
  const x = (index: number) =>
    margin.left + (index * plotWidth) / Math.max(1, pointCount - 1);
  const y = (value: number) =>
    margin.top + plotHeight - (value * plotHeight) / maximum;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const yPosition = margin.top + plotHeight * ratio;
    const value = Math.round(maximum * (1 - ratio));
    return `<line x1="${margin.left}" y1="${yPosition}" x2="${width - margin.right}" y2="${yPosition}" stroke="#e5e7eb"/><text x="${margin.left - 12}" y="${yPosition + 4}" text-anchor="end" font-size="12" fill="#4b5563">${formatNumber(value)}</text>`;
  }).join("");
  const lines = options.series
    .map((entry, seriesIndex) => {
      const color = COLORS[seriesIndex % COLORS.length];
      const segments: string[][] = [];
      let segment: string[] = [];
      entry.analysis.points.forEach((point, index) => {
        if (point.views === null) {
          if (segment.length > 0) segments.push(segment);
          segment = [];
        } else {
          segment.push(`${x(index)},${y(point.views)}`);
        }
      });
      if (segment.length > 0) segments.push(segment);
      return segments
        .map(
          (points) =>
            `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
        )
        .join("");
    })
    .join("");
  const legend = options.series
    .map((entry, index) => {
      const xPosition = margin.left + index * 190;
      const color = COLORS[index % COLORS.length];
      return `<line x1="${xPosition}" y1="42" x2="${xPosition + 24}" y2="42" stroke="${color}" stroke-width="4"/><text x="${xPosition + 32}" y="47" font-size="14" fill="#111827">${escapeXml(entry.label)}</text>`;
    })
    .join("");
  const periods = options.series[0]?.analysis.points ?? [];
  const firstPeriod = periods[0]?.period ?? "";
  const lastPeriod = periods.at(-1)?.period ?? "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(options.title)}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${margin.left}" y="26" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="#111827">${escapeXml(options.title)}</text>
  <g font-family="system-ui, sans-serif">${legend}</g>
  <g font-family="system-ui, sans-serif">${grid}</g>
  <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" stroke="#6b7280"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#6b7280"/>
  ${lines}
  <g font-family="system-ui, sans-serif" font-size="12" fill="#4b5563">
    <text x="${margin.left}" y="${height - 35}" text-anchor="start">${escapeXml(firstPeriod)}</text>
    <text x="${width - margin.right}" y="${height - 35}" text-anchor="end">${escapeXml(lastPeriod)}</text>
    <text x="20" y="${margin.top + plotHeight / 2}" transform="rotate(-90 20 ${margin.top + plotHeight / 2})" text-anchor="middle">Page views</text>
  </g>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}
