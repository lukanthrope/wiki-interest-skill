---
name: wiki-interest-skill
description: Analyze Wikipedia page-view trends across topics, languages, and time periods. Use when comparing audience interest, evaluating whether interest is growing, or preparing data-backed charts and short reports from Wikimedia page-view data.
compatibility: Requires Node.js 20+ and network access to Wikimedia APIs.
---

# Wikipedia Interest Analysis

Use this skill to evaluate changes in audience interest using Wikipedia page-view data.

## Setup

Before running the analysis, check whether `node_modules` exists in the skill
directory. If it is missing, run the following command from that directory:

```bash
npm ci
```

Do not reinstall dependencies when `node_modules` is already present. If the
installation requires network access or additional permissions, request them
before continuing.

## Workflow

1. Identify the topic, Wikipedia language editions, and analysis period requested by the user.
2. Resolve and report the Wikipedia articles used for the comparison.
3. Ask for clarification if a topic maps to multiple substantially different articles.
4. Create a JSON request that groups equivalent language editions under the
   same topic and keeps different concepts in separate topics, then run:

   ```bash
   WIKIMEDIA_USER_AGENT="wiki-interest-skill/0.1.0 (contact@example.com)" \
     npm run --silent analyze -- --input request.json --output output
   ```

   Copy `assets/request.example.json` to a writable working location and adapt
   it as the input request. Do not modify the template in place. For a single
   article, the direct `--article`, `--language`, `--start`, and `--end`
   options remain available.

5. Read `output/analysis.json`. Base conclusions on its normalized points,
   metrics, trends, and warnings. Use the SVG files under `output/charts/`
   when a visualization is requested.
6. Distinguish Wikipedia interest from commercial demand or willingness to pay.
7. After presenting a successful analysis, ask about optional deliverables if
   the user has not already specified them. Ask in the user's language using
   this meaning:

   > Show the chart? A reply of "yes" means the chart only. If you also want a
   > PDF, say so explicitly, for example: "yes, the chart and PDF."

   Treat an unqualified affirmative reply as consent to show the chart only.
   Create a PDF only when the user explicitly mentions PDF. Do not ask again
   about a deliverable that the user already requested or declined.
8. When the user requests PDF export, write the complete response to a Markdown
   file. Use the bundled exporter as the only PDF authoring path. Do not create,
   recreate, or repair the report with ReportLab, browser printing, or another
   general-purpose PDF generator. General PDF tools may be used only to render
   and inspect the generated file. If export fails or visual inspection finds a
   layout defect, fix `scripts/pdf-report.ts` or the report content and rerun the
   bundled exporter:

   ```bash
   npm run --silent export:pdf -- \
     --content output/report.md \
     --analysis output/analysis.json \
     --output output/pdf/wiki-interest-report.pdf \
     --title "Wikipedia Interest Report"
   ```

   Repeat `--content` to include complete results from multiple prompts, and
   repeat `--analysis` when those results use separate analysis files. Include
   only the responses and analyses relevant to the user's requested scope.

## Outputs

- `output/raw-pageviews.json`: unmodified time-series items returned by Wikimedia.
- `output/analysis.json`: normalized points, metrics, trend estimates, warnings, and artifact paths.
- `output/charts/<topic-id>.svg`: one line chart per topic.
- `output/pdf/wiki-interest-report.pdf`: optional report containing the complete
  Markdown response, selected analyses, metrics, warnings, and charts.

## Data handling

- Use `user` traffic by default to exclude known spider and automated traffic.
- Treat a `404` as ambiguous: it can mean zero views, unavailable data, or an invalid article/project combination.
- Do not silently fill missing time-series points until the requested period and data availability have been checked.
- Missing periods must remain `null`, not zero, in normalized output.
- Make requests sequentially and use a descriptive `User-Agent` containing contact information.
- Compare `series` entries within the same returned topic only after checking that their article titles represent the same concept.
- Keep unrelated concepts in separate topics so charts and conclusions do not mix them accidentally.
- Treat trend direction as descriptive evidence, not proof of future demand. Check `rSquared`, volatility, traffic-spike warnings, and history length before making recommendations.
- Do not claim that an analysis has succeeded unless the script completes and produces validated output.
