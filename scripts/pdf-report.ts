import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { marked, type Token, type Tokens } from "marked";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";

import type { AnalysisWarning, SeriesMetrics, TrendAnalysis } from "./pageview-analysis.js";

export type ReportAnalysis = {
  request: {
    start: string;
    end: string;
    granularity: string;
  };
  topics: Array<{
    id: string;
    label: string;
    chart?: string;
    series: Array<{
      language: string;
      article: string;
      project: string;
      metrics: SeriesMetrics;
      trend: TrendAnalysis;
      warnings: AnalysisWarning[];
    }>;
  }>;
};

export type MarkdownSection = {
  source: string;
  markdown: string;
};

export type PdfReportOptions = {
  outputPath: string;
  title: string;
  markdownSections: MarkdownSection[];
  analyses: Array<{
    source: string;
    directory: string;
    value: ReportAnalysis;
  }>;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const require = createRequire(import.meta.url);
const fontsDirectory = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");

export async function createPdfReport(options: PdfReportOptions): Promise<void> {
  const document = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, right: MARGIN, bottom: 64, left: MARGIN },
    bufferPages: true,
    info: { Title: options.title, Creator: "wiki-interest-skill" },
  });
  document.registerFont("Body", join(fontsDirectory, "DejaVuSans.ttf"));
  document.registerFont("Bold", join(fontsDirectory, "DejaVuSans-Bold.ttf"));
  document.registerFont("Mono", join(fontsDirectory, "DejaVuSansMono.ttf"));

  const completion = new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(options.outputPath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    document.on("error", reject);
    document.pipe(stream);
  });

  document.font("Bold").fontSize(24).fillColor("#111827").text(options.title);
  document.moveDown(0.45);
  document
    .font("Body")
    .fontSize(9)
    .fillColor("#6b7280")
    .text(`Generated ${new Date().toISOString().slice(0, 10)}`);
  document.moveDown(1.5);

  for (const [index, section] of options.markdownSections.entries()) {
    if (index > 0) document.addPage();
    if (options.markdownSections.length > 1) {
      document.font("Bold").fontSize(9).fillColor("#6b7280").text(section.source);
      document.moveDown(0.8);
    }
    renderMarkdown(document, section.markdown);
  }

  for (const analysis of options.analyses) {
    for (const topic of analysis.value.topics) {
      document.addPage();
      document.font("Bold").fontSize(18).fillColor("#111827").text(topic.label);
      document
        .font("Body")
        .fontSize(8.5)
        .fillColor("#6b7280")
        .text(
          `${analysis.value.request.start} to ${analysis.value.request.end} - ` +
            `${analysis.value.request.granularity}; source: ${analysis.source}`,
        );
      document.moveDown(0.55);

      if (topic.chart) {
        const chartPath = join(analysis.directory, topic.chart);
        try {
          const svg = await readFile(chartPath, "utf8");
          SVGtoPDF(document, svg, MARGIN, document.y, {
            width: CONTENT_WIDTH,
            height: 235,
            preserveAspectRatio: "xMidYMid meet",
          });
          document.y += 248;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          document
            .font("Body")
            .fontSize(9)
            .fillColor("#b45309")
            .text(`Chart unavailable: ${message}`);
          document.moveDown(0.7);
        }
      }

      for (const series of topic.series) {
        ensureSpace(document, 180 + series.warnings.length * 18);
        document
          .font("Bold")
          .fontSize(12)
          .fillColor("#1f2937")
          .text(`${series.language}: ${series.article}`);
        document
          .font("Body")
          .fontSize(8)
          .fillColor("#6b7280")
          .text(series.project);
        document.moveDown(0.45);
        renderMetrics(document, series.metrics, series.trend);

        if (series.warnings.length > 0) {
          document.moveDown(0.45);
          document.font("Bold").fontSize(9).fillColor("#92400e").text("Warnings");
          for (const warning of series.warnings) {
            document
              .font("Body")
              .fontSize(8.5)
              .fillColor("#78350f")
              .text(`- ${warning.message}`, { indent: 8 });
          }
        }
        document.moveDown(0.9);
      }
    }
  }

  addPageNumbers(document);
  document.end();
  await completion;
}

function renderMarkdown(document: PDFKit.PDFDocument, markdown: string): void {
  const tokens = marked.lexer(markdown);
  for (const token of tokens) renderBlock(document, token);
}

function renderBlock(document: PDFKit.PDFDocument, token: Token): void {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      const sizes = [22, 18, 15, 13, 11, 10];
      ensureSpace(document, 50);
      document
        .font("Bold")
        .fontSize(sizes[Math.min(heading.depth, 6) - 1] ?? 10)
        .fillColor("#111827")
        .text(inlineText(heading.tokens));
      document.moveDown(0.45);
      break;
    }
    case "paragraph": {
      const paragraph = token as Tokens.Paragraph;
      document
        .font("Body")
        .fontSize(10.5)
        .fillColor("#1f2937")
        .text(inlineText(paragraph.tokens), { lineGap: 2 });
      document.moveDown(0.65);
      break;
    }
    case "list": {
      const list = token as Tokens.List;
      list.items.forEach((item, index) => {
        ensureSpace(document, 28);
        const marker = list.ordered ? `${(list.start || 1) + index}.` : "-";
        document
          .font("Body")
          .fontSize(10)
          .fillColor("#1f2937")
          .text(`${marker} ${inlineText(item.tokens)}`, { indent: 12, lineGap: 2 });
      });
      document.moveDown(0.55);
      break;
    }
    case "blockquote": {
      const quote = token as Tokens.Blockquote;
      const text = quote.tokens.map((child) => blockText(child)).join("\n");
      ensureSpace(document, 42);
      const y = document.y;
      document
        .font("Body")
        .fontSize(10)
        .fillColor("#4b5563")
        .text(text, MARGIN + 16, y, { width: CONTENT_WIDTH - 16, lineGap: 2 });
      document
        .save()
        .strokeColor("#93c5fd")
        .lineWidth(3)
        .moveTo(MARGIN + 4, y)
        .lineTo(MARGIN + 4, document.y)
        .stroke()
        .restore();
      document.moveDown(0.65);
      break;
    }
    case "code": {
      const code = token as Tokens.Code;
      ensureSpace(document, 60);
      document
        .font("Mono")
        .fontSize(8.2)
        .fillColor("#111827")
        .text(code.text, { lineGap: 1 });
      document.moveDown(0.7);
      break;
    }
    case "table":
      renderMarkdownTable(document, token as Tokens.Table);
      break;
    case "hr":
      document
        .moveDown(0.4)
        .strokeColor("#d1d5db")
        .moveTo(MARGIN, document.y)
        .lineTo(PAGE_WIDTH - MARGIN, document.y)
        .stroke()
        .moveDown(0.8);
      break;
    case "space":
      break;
    default: {
      const text = blockText(token);
      if (text.trim()) {
        document.font("Body").fontSize(10.5).fillColor("#1f2937").text(text);
        document.moveDown(0.6);
      }
    }
  }
}

function renderMarkdownTable(document: PDFKit.PDFDocument, table: Tokens.Table): void {
  const rows = [table.header, ...table.rows].map((row) => row.map((cell) => inlineText(cell.tokens)));
  const columnWidth = CONTENT_WIDTH / Math.max(1, table.header.length);
  for (const [rowIndex, row] of rows.entries()) {
    ensureSpace(document, 30);
    const y = document.y;
    const height = Math.max(
      24,
      ...row.map((cell) =>
        document.heightOfString(cell, { width: columnWidth - 10, lineGap: 1 }),
      ),
    );
    document.save().fillColor(rowIndex === 0 ? "#e5e7eb" : "#f9fafb").rect(MARGIN, y, CONTENT_WIDTH, height).fill().restore();
    row.forEach((cell, columnIndex) => {
      document
        .font(rowIndex === 0 ? "Bold" : "Body")
        .fontSize(8.5)
        .fillColor("#1f2937")
        .text(cell, MARGIN + columnIndex * columnWidth + 5, y + 6, {
          width: columnWidth - 10,
          lineGap: 1,
        });
    });
    document.y = y + height;
  }
  document.moveDown(0.7);
}

function renderMetrics(
  document: PDFKit.PDFDocument,
  metrics: SeriesMetrics,
  trend: TrendAnalysis,
): void {
  const rows: Array<[string, string]> = [
    ["Total views", formatNumber(metrics.totalViews)],
    ["Average", formatNumber(metrics.averageViews)],
    ["Median", formatNumber(metrics.medianViews)],
    ["Growth", formatPercent(metrics.growthPercent)],
    ["Trend", trend.direction],
    ["Predicted change", formatPercent(trend.predictedChangePercent)],
    ["R-squared", formatNumber(trend.rSquared)],
    ["Missing periods", `${metrics.missingPoints} / ${metrics.expectedPoints}`],
  ];
  const rowHeight = 19;
  const leftWidth = 145;
  const startY = document.y;

  rows.forEach(([label, value], index) => {
    const y = startY + index * rowHeight;
    document.save().fillColor(index % 2 === 0 ? "#f3f4f6" : "#ffffff").rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill().restore();
    document.font("Bold").fontSize(8.5).fillColor("#374151").text(label, MARGIN + 6, y + 5, { width: leftWidth - 12 });
    document.font("Body").fontSize(8.5).fillColor("#111827").text(value, MARGIN + leftWidth, y + 5, { width: CONTENT_WIDTH - leftWidth - 6 });
  });
  document.y = startY + rows.length * rowHeight;
}

function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  return tokens.map((token) => {
    if (token.type === "link") {
      const link = token as Tokens.Link;
      const label = inlineText(link.tokens);
      return link.href && link.href !== label ? `${label} (${link.href})` : label;
    }
    if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
    if ("text" in token && typeof token.text === "string") return token.text;
    if (token.type === "br") return "\n";
    return "";
  }).join("");
}

function blockText(token: Token): string {
  if (token.type === "list_item") return inlineText((token as Tokens.ListItem).tokens);
  if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
  if ("text" in token && typeof token.text === "string") return token.text;
  return "";
}

function ensureSpace(document: PDFKit.PDFDocument, requiredHeight: number): void {
  if (document.y + requiredHeight > PAGE_HEIGHT - 64) document.addPage();
}

function addPageNumbers(document: PDFKit.PDFDocument): void {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    const bottomMargin = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    document
      .font("Body")
      .fontSize(8)
      .fillColor("#9ca3af")
      .text(`${index + 1} / ${range.count}`, MARGIN, PAGE_HEIGHT - 34, {
        width: CONTENT_WIDTH,
        align: "center",
        lineBreak: false,
      });
    document.page.margins.bottom = bottomMargin;
  }
}

function formatNumber(value: number | null): string {
  return value === null ? "n/a" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${formatNumber(value)}%`;
}
