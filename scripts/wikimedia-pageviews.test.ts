import assert from "node:assert/strict";
import test from "node:test";

import {
  WikimediaApiError,
  WikimediaPageviewsClient,
} from "./wikimedia-pageviews.js";

const userAgent = "wiki-interest-skill/0.1.0 (test@example.com)";

test("builds a monthly per-article URL and encodes the title", () => {
  const client = new WikimediaPageviewsClient({ userAgent });
  const url = client.buildPerArticleUrl({
    project: "uk.wikipedia.org",
    article: "Штучний інтелект",
    start: "2024-01",
    end: "2024-12",
  });

  assert.equal(
    url,
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/" +
      "uk.wikipedia.org/all-access/user/%D0%A8%D1%82%D1%83%D1%87%D0%BD%D0%B8%D0%B9%20" +
      "%D1%96%D0%BD%D1%82%D0%B5%D0%BB%D0%B5%D0%BA%D1%82/monthly/20240101/20241231",
  );
});

test("rejects an invalid date range", () => {
  const client = new WikimediaPageviewsClient({ userAgent });
  assert.throws(
    () =>
      client.buildPerArticleUrl({
        project: "en.wikipedia.org",
        article: "Astronomy",
        start: "2025-01",
        end: "2024-01",
      }),
    /must not be after/,
  );
});

test("returns validated pageview items", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            project: "en.wikipedia",
            article: "Astronomy",
            granularity: "monthly",
            timestamp: "2024010100",
            access: "all-access",
            agent: "user",
            views: 123,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const client = new WikimediaPageviewsClient({ userAgent, fetch: fetchMock });
  const items = await client.getPerArticlePageviews({
    project: "en.wikipedia.org",
    article: "Astronomy",
    start: "2024-01",
    end: "2024-01",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.views, 123);
});

test("preserves the status and response body for API errors", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(JSON.stringify({ detail: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  const client = new WikimediaPageviewsClient({ userAgent, fetch: fetchMock });

  await assert.rejects(
    () =>
      client.getPerArticlePageviews({
        project: "en.wikipedia.org",
        article: "Missing article",
        start: "2024-01",
        end: "2024-01",
      }),
    (error: unknown) =>
      error instanceof WikimediaApiError &&
      error.status === 404 &&
      /zero page views/.test(error.message),
  );
});
