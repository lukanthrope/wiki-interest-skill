# Wikipedia Interest Skill

A reusable Agent Skill for analyzing and comparing Wikipedia page-view trends
across topics, languages, and time periods. It produces normalized time-series
data, descriptive metrics, trend estimates, warnings, SVG charts, and optional
PDF reports.

## Features

- Fetches per-article page views from the Wikimedia Analytics API.
- Compares equivalent articles across Wikipedia language editions.
- Keeps unrelated topics separate while analyzing them in one request.
- Normalizes missing periods without silently converting them to zero.
- Calculates totals, averages, medians, growth, volatility, linear trends, and
  trend confidence (`rSquared`).
- Detects short histories, missing periods, traffic spikes, high volatility,
  weak trends, and potentially incomplete current periods.
- Generates one SVG chart per topic.
- Exports the complete written response, metrics, warnings, and charts to PDF.
- Includes unit tests and agent-level evaluation cases.

## Requirements

- Node.js 20 or newer
- npm
- Network access to Wikimedia APIs

Install the dependencies:

```bash
npm ci
```

## Analyze multiple topics or languages

Copy the bundled request template and adapt it:

```bash
cp assets/request.example.json request.json
```

Example request:

```json
{
  "topics": [
    {
      "id": "astronomy",
      "label": "Astronomy",
      "articles": [
        { "language": "en", "title": "Astronomy" },
        { "language": "uk", "title": "Астрономія" }
      ]
    }
  ],
  "start": "2024-01",
  "end": "2024-12",
  "granularity": "monthly"
}
```

Run the analysis with a descriptive Wikimedia `User-Agent`. Replace the contact
placeholder with your own contact information:

```bash
WIKIMEDIA_USER_AGENT="wiki-interest-skill/0.1.0 (contact@example.com)" \
  npm run --silent analyze -- \
  --input request.json \
  --output output
```

For a single article, the CLI also supports direct options:

```bash
WIKIMEDIA_USER_AGENT="wiki-interest-skill/0.1.0 (contact@example.com)" \
  npm run --silent analyze -- \
  --article "Astronomy" \
  --language en \
  --start 2024-01 \
  --end 2024-12 \
  --granularity monthly \
  --output output
```

## Outputs

```text
output/
├── raw-pageviews.json
├── analysis.json
└── charts/
    └── <topic-id>.svg
```

- `raw-pageviews.json` contains the Wikimedia response items.
- `analysis.json` contains normalized points, metrics, trend estimates, warnings,
  and artifact paths.
- `charts/<topic-id>.svg` contains a line chart for each topic.

## PDF export

Write the complete response to a Markdown file, then run the bundled PDFKit
exporter:

```bash
npm run --silent export:pdf -- \
  --content output/report.md \
  --analysis output/analysis.json \
  --output output/pdf/wiki-interest-report.pdf \
  --title "Wikipedia Interest Report"
```

Repeat `--content` to combine multiple written responses and repeat `--analysis`
to include multiple analysis files in one PDF.

## Install as a local Codex skill

For local development, link the repository into the personal Codex skills
directory:

```bash
ln -s \
  /absolute/path/to/wiki-interest-skill \
  ~/.codex/skills/wiki-interest-skill
```

Start a new Codex task and invoke it explicitly for the first test:

```text
$wiki-interest-skill Compare interest in astronomy across English and Ukrainian Wikipedia during 2024.
```

The skill automatically runs `npm ci` on first use when `node_modules` is not
present.

## Testing

Run the TypeScript check and unit tests:

```bash
npm run typecheck
npm test
```

The repository currently includes 13 unit tests covering request validation,
Wikimedia URL construction and errors, normalization, metrics, trends, warnings,
SVG rendering, and PDF generation.

Agent-level evaluation cases are defined in `evals/evals.json`. They cover:

- cross-language analysis;
- multi-topic analysis with charts and PDF export;
- requests that predate Wikimedia Pageviews availability;
- ambiguous requests that require scope clarification.

An optional OpenRouter-based runner is available:

```bash
npm run eval:run
```

It reads these local variables from `.env`:

```text
OPENROUTER_API_KEY=...
EVAL_AGENT_MODEL=openai/gpt-4o-mini
EVAL_JUDGE_MODEL=openai/gpt-4o-mini
```

The `.env` file and generated `eval-workspace/` directory are ignored by Git.

## Data limitations

- Wikimedia Pageviews data is available only from July 2015 onward.
- A missing period is kept as `null`; it is not assumed to have zero views.
- A `404` can indicate an invalid article/project combination, unavailable data,
  or no returned views.
- Wikipedia page views measure informational attention, not commercial demand or
  willingness to pay.
- Trend direction is descriptive. Review volatility, `rSquared`, warnings, and
  history length before drawing conclusions.
