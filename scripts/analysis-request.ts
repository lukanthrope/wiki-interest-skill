import type { PageviewsGranularity } from "./wikimedia-pageviews.js";

export type ArticleRequest = {
  language: string;
  title: string;
};

export type TopicRequest = {
  id: string;
  label: string;
  articles: ArticleRequest[];
};

export type ComparisonRequest = {
  topics: TopicRequest[];
  start: string;
  end: string;
  granularity: PageviewsGranularity;
};

export function parseComparisonRequest(value: unknown): ComparisonRequest {
  if (!isRecord(value)) {
    throw new Error("The input file must contain a JSON object.");
  }

  if (!Array.isArray(value.topics) || value.topics.length === 0) {
    throw new Error('The input file must contain a non-empty "topics" array.');
  }

  const topics = value.topics.map((topic, index) => parseTopicRequest(topic, index));
  assertUniqueTopicIds(topics);
  const start = requireString(value, "start");
  const end = requireString(value, "end");
  const granularity = parseGranularity(value.granularity);

  return { topics, start, end, granularity };
}

function parseTopicRequest(value: unknown, topicIndex: number): TopicRequest {
  if (!isRecord(value)) {
    throw new Error(`topics[${topicIndex}] must be a JSON object.`);
  }

  const path = `topics[${topicIndex}]`;
  const id = requireString(value, "id", path);
  const label = requireString(value, "label", path);

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(
      `${path}.id must contain lowercase letters, numbers, and single hyphens only.`,
    );
  }
  if (!Array.isArray(value.articles) || value.articles.length === 0) {
    throw new Error(`${path}.articles must be a non-empty array.`);
  }

  const articles = value.articles.map((article, articleIndex) =>
    parseArticleRequest(article, topicIndex, articleIndex),
  );
  return { id, label, articles };
}

function parseArticleRequest(
  value: unknown,
  topicIndex: number,
  articleIndex: number,
): ArticleRequest {
  const path = `topics[${topicIndex}].articles[${articleIndex}]`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be a JSON object.`);
  }

  const language = requireString(value, "language", path);
  const title = requireString(value, "title", path);

  if (!/^[a-z][a-z0-9-]*$/i.test(language)) {
    throw new Error(
      `${path}.language must be a Wikipedia language code such as "en" or "uk".`,
    );
  }

  return { language: language.toLowerCase(), title };
}

function assertUniqueTopicIds(topics: TopicRequest[]): void {
  const ids = new Set<string>();
  for (const topic of topics) {
    if (ids.has(topic.id)) {
      throw new Error(`Topic id "${topic.id}" must be unique.`);
    }
    ids.add(topic.id);
  }
}

function parseGranularity(value: unknown): PageviewsGranularity {
  if (value === undefined) return "monthly";
  if (value !== "daily" && value !== "monthly") {
    throw new Error('"granularity" must be either "daily" or "monthly".');
  }
  return value;
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path = "input",
): string {
  const property = value[key];
  if (typeof property !== "string" || !property.trim()) {
    throw new Error(`${path}.${key} must be a non-empty string.`);
  }
  return property.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
