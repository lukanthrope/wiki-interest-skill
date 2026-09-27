import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createPdfReport,
  type MarkdownSection,
  type ReportAnalysis,
} from "./pdf-report.js";

type CliOptions = {
  analysis: string[];
  content: string[];
  output?: string;
  title?: string;
};

function readOptions(args: string[]): CliOptions {
  const options: CliOptions = { analysis: [], content: [] };
  const repeatable = new Set(["analysis", "content"]);
  const single = new Set(["output", "title"]);

  for (let index = 0; index < args.length; index += 2) {
    const rawKey = args[index];
    const value = args[index + 1];
    if (!rawKey?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid CLI argument near "${rawKey ?? "<empty>"}".`);
    }
    const key = rawKey.slice(2);
    if (repeatable.has(key)) {
      (options[key as "analysis" | "content"] as string[]).push(value);
    } else if (single.has(key)) {
      options[key as "output" | "title"] = value;
    } else {
      throw new Error(`Unknown option "--${key}".`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  if (options.content.length === 0) {
    throw new Error('Provide at least one complete response with "--content <report.md>".');
  }

  const outputPath = resolve(process.cwd(), options.output ?? "output/pdf/wiki-interest-report.pdf");
  const markdownSections: MarkdownSection[] = await Promise.all(
    options.content.map(async (path) => {
      const absolutePath = resolve(process.cwd(), path);
      return { source: path, markdown: await readFile(absolutePath, "utf8") };
    }),
  );
  const analyses = await Promise.all(
    options.analysis.map(async (path) => {
      const absolutePath = resolve(process.cwd(), path);
      const value = JSON.parse(await readFile(absolutePath, "utf8")) as ReportAnalysis;
      assertAnalysis(value, path);
      return { source: path, directory: dirname(absolutePath), value };
    }),
  );

  await mkdir(dirname(outputPath), { recursive: true });
  await createPdfReport({
    outputPath,
    title: options.title ?? "Wikipedia Interest Report",
    markdownSections,
    analyses,
  });
  console.log(JSON.stringify({ pdf: outputPath }, null, 2));
}

function assertAnalysis(value: unknown, source: string): asserts value is ReportAnalysis {
  if (
    typeof value !== "object" ||
    value === null ||
    !("request" in value) ||
    !("topics" in value) ||
    !Array.isArray(value.topics)
  ) {
    throw new Error(`Analysis file "${source}" does not match analysis.json.`);
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
