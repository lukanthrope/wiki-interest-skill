import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  parseComparisonRequest,
  type ComparisonRequest,
} from "./analysis-request.js";
import {
  analyzePageviewSeries,
  type AnalyzedSeries,
} from "./pageview-analysis.js";
import { renderTopicChart } from "./visualization.js";
import {
  WikimediaApiError,
  WikimediaPageviewsClient,
  type PageviewsGranularity,
} from "./wikimedia-pageviews.js";

type CliOptions = {
  input?: string;
  output?: string;
  article?: string;
  language?: string;
  start?: string;
  end?: string;
  granularity?: PageviewsGranularity;
};

const supportedOptions = new Set<keyof CliOptions>([
  "input",
  "output",
  "article",
  "language",
  "start",
  "end",
  "granularity",
]);

function readOptions(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];

    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid CLI argument near "${key ?? "<empty>"}".`);
    }

    const option = key.slice(2) as keyof CliOptions;
    if (!supportedOptions.has(option)) {
      throw new Error(`Unknown option "--${option}".`);
    }

    if (option === "granularity") {
      if (value !== "daily" && value !== "monthly") {
        throw new Error('Granularity must be either "daily" or "monthly".');
      }
      options.granularity = value;
    } else {
      options[option] = value;
    }
  }

  return options;
}

function requireOption<K extends keyof CliOptions>(
  options: CliOptions,
  key: K,
): NonNullable<CliOptions[K]> {
  const value = options[key];
  if (!value) throw new Error(`Missing required option "--${key}".`);
  return value as NonNullable<CliOptions[K]>;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const request = await createRequest(options);
  const userAgent = process.env.WIKIMEDIA_USER_AGENT;

  if (!userAgent) {
    throw new Error(
      "Set WIKIMEDIA_USER_AGENT to a descriptive value containing contact information, " +
        'for example: "wiki-interest-skill/0.1.0 (you@example.com)".',
    );
  }

  const client = new WikimediaPageviewsClient({ userAgent });
  const outputDirectory = resolve(process.cwd(), options.output ?? "output");
  const chartsDirectory = join(outputDirectory, "charts");
  const topics: Array<{
    id: string;
    label: string;
    chart: string;
    series: Array<{
      language: string;
      article: string;
      project: string;
      analysis: AnalyzedSeries;
    }>;
  }> = [];
  const rawTopics: Array<{
    id: string;
    label: string;
    series: Array<{
      language: string;
      article: string;
      project: string;
      items: Awaited<ReturnType<WikimediaPageviewsClient["getPerArticlePageviews"]>>;
    }>;
  }> = [];

  // Wikimedia recommends waiting for each request to finish before starting
  // another one, so both loops are intentionally sequential.
  for (const topic of request.topics) {
    const series = [];
    const rawSeries = [];

    for (const article of topic.articles) {
      const project = `${article.language}.wikipedia.org`;
      const items = await client.getPerArticlePageviews({
        project,
        article: article.title,
        start: request.start,
        end: request.end,
        granularity: request.granularity,
        access: "all-access",
        agent: "user",
      });

      const analysis = analyzePageviewSeries({
        items,
        start: request.start,
        end: request.end,
        granularity: request.granularity,
      });

      rawSeries.push({
        language: article.language,
        article: article.title,
        project,
        items,
      });
      series.push({
        language: article.language,
        article: article.title,
        project,
        analysis,
      });
    }

    const chart = `charts/${topic.id}.svg`;
    topics.push({ id: topic.id, label: topic.label, chart, series });
    rawTopics.push({ id: topic.id, label: topic.label, series: rawSeries });
  }

  await mkdir(chartsDirectory, { recursive: true });
  for (const topic of topics) {
    const svg = renderTopicChart({
      title: topic.label,
      series: topic.series.map((entry) => ({
        label: `${entry.language}: ${entry.article}`,
        analysis: entry.analysis,
      })),
    });
    await writeFile(join(outputDirectory, topic.chart), svg, "utf8");
  }

  const requestSummary = {
    start: request.start,
    end: request.end,
    granularity: request.granularity,
  };
  const result = {
    request: requestSummary,
    topics: topics.map((topic) => ({
      id: topic.id,
      label: topic.label,
      chart: topic.chart,
      series: topic.series.map((entry) => ({
        language: entry.language,
        article: entry.article,
        project: entry.project,
        ...entry.analysis,
      })),
    })),
    artifacts: {
      rawPageviews: "raw-pageviews.json",
      analysis: "analysis.json",
      charts: topics.map((topic) => topic.chart),
    },
  };

  await writeFile(
    join(outputDirectory, "raw-pageviews.json"),
    `${JSON.stringify({ request: requestSummary, topics: rawTopics }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "analysis.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(result, null, 2));
}

async function createRequest(options: CliOptions): Promise<ComparisonRequest> {
  if (options.input) {
    const otherOptions = Object.entries(options).filter(
      ([key, value]) => key !== "input" && key !== "output" && value !== undefined,
    );
    if (otherOptions.length > 0) {
      throw new Error('"--input" cannot be combined with other CLI options.');
    }

    const inputPath = resolve(process.cwd(), options.input);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read input file "${inputPath}": ${message}`);
    }
    return parseComparisonRequest(parsed);
  }

  return {
    topics: [
      {
        id: "single-topic",
        label: requireOption(options, "article"),
        articles: [
          {
            language: requireOption(options, "language"),
            title: requireOption(options, "article"),
          },
        ],
      },
    ],
    start: requireOption(options, "start"),
    end: requireOption(options, "end"),
    granularity: options.granularity ?? "monthly",
  };
}

main().catch((error: unknown) => {
  const output =
    error instanceof WikimediaApiError
      ? {
          error: error.name,
          message: error.message,
          status: error.status,
          responseBody: error.responseBody,
        }
      : {
          error: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
        };

  console.error(JSON.stringify(output, null, 2));
  process.exitCode = 1;
});
