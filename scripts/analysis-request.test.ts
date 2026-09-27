import assert from "node:assert/strict";
import test from "node:test";

import { parseComparisonRequest } from "./analysis-request.js";

test("parses multiple topics and languages", () => {
  const request = parseComparisonRequest({
    topics: [
      {
        id: "astronomy",
        label: "Астрономія",
        articles: [
          { language: "en", title: "Astronomy" },
          { language: "uk", title: "Астрономія" },
        ],
      },
      {
        id: "physics",
        label: "Фізика",
        articles: [{ language: "uk", title: "Фізика" }],
      },
    ],
    start: "2024-01",
    end: "2024-12",
  });

  assert.deepEqual(request, {
    topics: [
      {
        id: "astronomy",
        label: "Астрономія",
        articles: [
          { language: "en", title: "Astronomy" },
          { language: "uk", title: "Астрономія" },
        ],
      },
      {
        id: "physics",
        label: "Фізика",
        articles: [{ language: "uk", title: "Фізика" }],
      },
    ],
    start: "2024-01",
    end: "2024-12",
    granularity: "monthly",
  });
});

test("rejects an empty topics array", () => {
  assert.throws(
    () =>
      parseComparisonRequest({
        topics: [],
        start: "2024-01",
        end: "2024-12",
      }),
    /non-empty "topics" array/,
  );
});

test("rejects an invalid language code", () => {
  assert.throws(
    () =>
      parseComparisonRequest({
        topics: [
          {
            id: "astronomy",
            label: "Astronomy",
            articles: [
              { language: "en.wikipedia.org", title: "Astronomy" },
            ],
          },
        ],
        start: "2024-01",
        end: "2024-12",
      }),
    /language code/,
  );
});

test("rejects duplicate topic ids", () => {
  assert.throws(
    () =>
      parseComparisonRequest({
        topics: [
          {
            id: "astronomy",
            label: "Astronomy",
            articles: [{ language: "en", title: "Astronomy" }],
          },
          {
            id: "astronomy",
            label: "Астрономія",
            articles: [{ language: "uk", title: "Астрономія" }],
          },
        ],
        start: "2024-01",
        end: "2024-12",
      }),
    /must be unique/,
  );
});
