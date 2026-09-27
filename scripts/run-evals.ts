import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

type EvalCase = {
  id: number;
  prompt: string;
  expected_output: string;
  assertions: string[];
};

type EvalFile = {
  skill_name: string;
  evals: EvalCase[];
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenRouterResponse = {
  choices?: Array<{ message?: ChatMessage }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

type Grade = {
  assertion_results: Array<{ text: string; passed: boolean; evidence: string }>;
  summary: { passed: number; failed: number; total: number; pass_rate: number };
};

const skillRoot = resolve(process.cwd());
const env = await loadEnvironment(join(skillRoot, ".env"));
const apiKey = requireValue(env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY");
const agentModel = requireValue(env.EVAL_AGENT_MODEL, "EVAL_AGENT_MODEL");
const judgeModel = requireValue(env.EVAL_JUDGE_MODEL, "EVAL_JUDGE_MODEL");
const evalFile = JSON.parse(
  await readFile(join(skillRoot, "evals/evals.json"), "utf8"),
) as EvalFile;
const skillInstructions = await readFile(join(skillRoot, "SKILL.md"), "utf8");
const requestTemplate = await readFile(
  join(skillRoot, "assets/request.example.json"),
  "utf8",
);
const workspaceRoot = join(skillRoot, "eval-workspace");
const iteration = await nextIteration(workspaceRoot);
const iterationRoot = join(workspaceRoot, `iteration-${iteration}`);
await mkdir(iterationRoot, { recursive: true });

const benchmarkRuns: Array<{
  id: number;
  pass_rate: number;
  duration_ms: number;
  total_tokens: number;
}> = [];

for (const evalCase of evalFile.evals) {
  const runRoot = join(iterationRoot, `eval-${evalCase.id}`, "with_skill");
  const outputRoot = join(runRoot, "outputs");
  await mkdir(outputRoot, { recursive: true });
  const gradingPath = join(runRoot, "grading.json");
  const timingPath = join(runRoot, "timing.json");
  if ((await pathExists(gradingPath)) && (await pathExists(timingPath))) {
    const grade = JSON.parse(await readFile(gradingPath, "utf8")) as Grade;
    const timing = JSON.parse(await readFile(timingPath, "utf8")) as {
      duration_ms: number;
      total_tokens: number;
    };
    benchmarkRuns.push({
      id: evalCase.id,
      pass_rate: grade.summary.pass_rate,
      duration_ms: timing.duration_ms,
      total_tokens: timing.total_tokens,
    });
    process.stdout.write(`Skipping completed eval ${evalCase.id}.\n`);
    continue;
  }
  process.stdout.write(
    `Running eval ${evalCase.id}/${evalFile.evals.length}...\n`,
  );

  const startedAt = Date.now();
  const run = await executeAgent(evalCase, outputRoot);
  await writeFile(join(runRoot, "transcript.json"), json(run.messages), "utf8");
  await writeFile(
    join(outputRoot, "final-response.md"),
    `${run.finalResponse}\n`,
    "utf8",
  );

  const artifacts = await collectArtifacts(outputRoot);
  const grade = await gradeRun(
    evalCase,
    run.finalResponse,
    run.messages,
    artifacts,
  );
  const durationMs = Date.now() - startedAt;
  const timing = {
    duration_ms: durationMs,
    total_tokens: run.totalTokens,
    agent_model: agentModel,
    judge_model: judgeModel,
  };
  await writeFile(join(runRoot, "grading.json"), json(grade), "utf8");
  await writeFile(join(runRoot, "timing.json"), json(timing), "utf8");
  await writeFile(join(runRoot, "artifacts.json"), json(artifacts), "utf8");
  benchmarkRuns.push({
    id: evalCase.id,
    pass_rate: grade.summary.pass_rate,
    duration_ms: durationMs,
    total_tokens: run.totalTokens,
  });
  process.stdout.write(
    `Eval ${evalCase.id}: ${grade.summary.passed}/${grade.summary.total} assertions passed.\n`,
  );
}

const benchmark = {
  iteration,
  configuration: "with_skill",
  agent_model: agentModel,
  judge_model: judgeModel,
  runs: benchmarkRuns,
  aggregate: {
    pass_rate_mean: mean(benchmarkRuns.map((run) => run.pass_rate)),
    duration_ms_mean: mean(benchmarkRuns.map((run) => run.duration_ms)),
    total_tokens_mean: mean(benchmarkRuns.map((run) => run.total_tokens)),
  },
  note: "No without-skill baseline was run in this iteration.",
};
await writeFile(join(iterationRoot, "benchmark.json"), json(benchmark), "utf8");
process.stdout.write(`Completed iteration-${iteration}: ${iterationRoot}\n`);

async function executeAgent(
  evalCase: EvalCase,
  outputRoot: string,
): Promise<{
  finalResponse: string;
  messages: ChatMessage[];
  totalTokens: number;
}> {
  const system = `You are evaluating a local Agent Skill in an isolated workspace.

Follow the skill instructions exactly. Use only the provided tools. Tool paths are relative to the eval output directory. Never claim an artifact exists unless a tool created it. If the request is materially ambiguous and the skill requires clarification, ask the clarification in the final response instead of inventing scope.

Current date: 2026-09-27.

<skill>
${skillInstructions}
</skill>

The bundled request template is:
${requestTemplate}`;
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: evalCase.prompt },
  ];
  let totalTokens = 0;

  for (let turn = 0; turn < 12; turn += 1) {
    const response = await openRouterChat({
      model: agentModel,
      messages,
      tools: getToolDefinitions(),
      tool_choice: "auto",
      temperature: 0,
      max_tokens: 2000,
    });
    totalTokens += response.usage?.total_tokens ?? 0;
    const message = response.choices?.[0]?.message;
    if (!message)
      throw new Error(
        `Agent returned no message: ${JSON.stringify(response.error)}`,
      );
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        finalResponse: message.content?.trim() || "",
        messages,
        totalTokens,
      };
    }

    for (const call of message.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(call.function.arguments) as Record<
          string,
          unknown
        >;
        result = await executeTool(call.function.name, args, outputRoot);
      } catch (error: unknown) {
        result = JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: truncate(result, 20_000),
      });
    }
  }
  throw new Error(`Eval ${evalCase.id} exceeded the 12-turn tool limit.`);
}

function getToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Write a UTF-8 text file inside the isolated eval output directory.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["path", "content"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Read a UTF-8 file created inside the isolated eval output directory.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_analysis",
        description:
          "Run the bundled wiki-interest analyzer using a request JSON file.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["input_path", "output_directory"],
          properties: {
            input_path: { type: "string" },
            output_directory: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_pdf_export",
        description:
          "Run the bundled PDFKit exporter. Use only when the user explicitly requested PDF.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["content_paths", "analysis_paths", "output_path", "title"],
          properties: {
            content_paths: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            analysis_paths: { type: "array", items: { type: "string" } },
            output_path: { type: "string" },
            title: { type: "string" },
          },
        },
      },
    },
  ] as const;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  outputRoot: string,
): Promise<string> {
  if (name === "write_file") {
    const path = safePath(outputRoot, requireString(args.path, "path"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, requireString(args.content, "content"), "utf8");
    return JSON.stringify({ written: relative(outputRoot, path) });
  }
  if (name === "read_file") {
    const path = safePath(outputRoot, requireString(args.path, "path"));
    return await readFile(path, "utf8");
  }
  if (name === "run_analysis") {
    const input = safePath(
      outputRoot,
      requireString(args.input_path, "input_path"),
    );
    const output = safePath(
      outputRoot,
      requireString(args.output_directory, "output_directory"),
    );
    await mkdir(output, { recursive: true });
    return await runCommand(
      "npm",
      [
        "run",
        "--silent",
        "analyze",
        "--",
        "--input",
        input,
        "--output",
        output,
      ],
      {
        ...process.env,
        WIKIMEDIA_USER_AGENT:
          "wiki-interest-skill-eval/0.1.0 (local evaluation)",
      },
    );
  }
  if (name === "run_pdf_export") {
    const contentPaths = requireStringArray(
      args.content_paths,
      "content_paths",
    );
    const analysisPaths = requireStringArray(
      args.analysis_paths,
      "analysis_paths",
    );
    const output = safePath(
      outputRoot,
      requireString(args.output_path, "output_path"),
    );
    await mkdir(dirname(output), { recursive: true });
    const commandArgs = ["run", "--silent", "export:pdf", "--"];
    for (const path of contentPaths) {
      commandArgs.push("--content", safePath(outputRoot, path));
    }
    for (const path of analysisPaths) {
      commandArgs.push("--analysis", safePath(outputRoot, path));
    }
    commandArgs.push(
      "--output",
      output,
      "--title",
      requireString(args.title, "title"),
    );
    return await runCommand("npm", commandArgs, process.env);
  }
  throw new Error(`Unsupported tool: ${name}`);
}

async function gradeRun(
  evalCase: EvalCase,
  finalResponse: string,
  messages: ChatMessage[],
  artifacts: unknown,
): Promise<Grade> {
  const transcript = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: truncate(message.content ?? "", 8_000),
      tool_calls: message.tool_calls,
    }));
  const judgePrompt = {
    task: "Grade every assertion independently. PASS requires concrete evidence in the response, transcript, or artifact manifest. If evidence is missing or ambiguous, return FAIL. Do not reward intent. Return JSON only.",
    eval_prompt: evalCase.prompt,
    expected_output: evalCase.expected_output,
    assertions: evalCase.assertions,
    final_response: finalResponse,
    transcript,
    artifacts,
    required_shape: {
      assertion_results: [
        {
          text: "exact assertion",
          passed: true,
          evidence: "specific evidence",
        },
      ],
      summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 },
    },
  };
  const response = await openRouterChat({
    model: judgeModel,
    messages: [
      {
        role: "system",
        content:
          "You are a strict evaluation judge. Return one valid JSON object and no markdown.",
      },
      { role: "user", content: JSON.stringify(judgePrompt) },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 1500,
  });
  const content = response.choices?.[0]?.message?.content;
  if (!content)
    throw new Error(
      `Judge returned no content: ${JSON.stringify(response.error)}`,
    );
  const grade = JSON.parse(content) as Grade;
  validateGrade(grade, evalCase.assertions);
  return grade;
}

async function openRouterChat(
  body: Record<string, unknown>,
): Promise<OpenRouterResponse> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Title": "wiki-interest-skill-evals",
        },
        body: JSON.stringify(body),
      },
    );
    const text = await response.text();
    let parsed: OpenRouterResponse;
    try {
      parsed = JSON.parse(text) as OpenRouterResponse;
    } catch {
      throw new Error(
        `OpenRouter returned non-JSON status ${response.status}: ${truncate(text, 500)}`,
      );
    }
    if (response.ok) return parsed;
    if ((response.status === 402 || response.status === 429) && attempt < 3) {
      const waitMs = 5_000 * 2 ** attempt;
      process.stdout.write(
        `OpenRouter ${response.status}; retrying in ${waitMs / 1000}s...\n`,
      );
      await delay(waitMs);
      continue;
    }
    throw new Error(
      `OpenRouter ${response.status}: ${parsed.error?.message ?? truncate(text, 500)}`,
    );
  }
  throw new Error("OpenRouter retry limit exceeded.");
}

async function collectArtifacts(root: string): Promise<unknown> {
  const paths = await walk(root);
  return await Promise.all(
    paths.map(async (path) => {
      const info = await stat(path);
      const relativePath = relative(root, path);
      const entry: Record<string, unknown> = {
        path: relativePath,
        bytes: info.size,
      };
      if (path.endsWith(".json")) {
        try {
          entry.json = JSON.parse(await readFile(path, "utf8"));
        } catch {
          entry.valid_json = false;
        }
      } else if (path.endsWith(".md") || path.endsWith(".svg")) {
        entry.preview = truncate(await readFile(path, "utf8"), 5_000);
      } else if (path.endsWith(".pdf")) {
        const buffer = await readFile(path);
        const source = buffer.toString("latin1");
        entry.valid_pdf_header = buffer.subarray(0, 4).toString() === "%PDF";
        entry.producer_pdfkit = source.includes("PDFKit");
      }
      return entry;
    }),
  );
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

async function runCommand(
  command: string,
  args: string[],
  commandEnv: NodeJS.ProcessEnv,
): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: skillRoot,
      env: commandEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const combined = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
      if (code === 0) resolvePromise(combined);
      else
        reject(
          new Error(
            `${command} exited with ${code}: ${truncate(combined, 4_000)}`,
          ),
        );
    });
  });
}

async function nextIteration(root: string): Promise<number> {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const numbers = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^iteration-(\d+)$/.exec(entry.name))
    .flatMap((match) => (match ? [Number(match[1])] : []));
  if (numbers.length === 0) return 1;
  const latest = Math.max(...numbers);
  return (await pathExists(join(root, `iteration-${latest}`, "benchmark.json")))
    ? latest + 1
    : latest;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadEnvironment(path: string): Promise<Record<string, string>> {
  await access(path, constants.R_OK);
  const values: Record<string, string> = {};
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return {
    ...values,
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  };
}

function safePath(root: string, requested: string): string {
  const path = resolve(root, requested);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`Path escapes eval output directory: ${requested}`);
  }
  return path;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${name} must be an array of strings.`);
  }
  return value;
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is missing from .env.`);
  return value;
}

function validateGrade(grade: Grade, assertions: string[]): void {
  if (
    !Array.isArray(grade.assertion_results) ||
    grade.assertion_results.length !== assertions.length
  ) {
    throw new Error("Judge returned the wrong number of assertion results.");
  }
  for (const assertion of assertions) {
    if (!grade.assertion_results.some((result) => result.text === assertion)) {
      throw new Error(`Judge omitted assertion: ${assertion}`);
    }
  }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n...[truncated]`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}
