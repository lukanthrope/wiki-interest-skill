const DEFAULT_BASE_URL = "https://wikimedia.org/api/rest_v1";

export type PageviewsAccess =
  | "all-access"
  | "desktop"
  | "mobile-app"
  | "mobile-web";
export type PageviewsAgent = "all-agents" | "user" | "spider" | "automated";
export type PageviewsGranularity = "daily" | "monthly";

export type PageviewsRequest = {
  project: string;
  article: string;
  start: string;
  end: string;
  access?: PageviewsAccess;
  agent?: PageviewsAgent;
  granularity?: PageviewsGranularity;
};

export type PageviewItem = {
  project: string;
  article: string;
  granularity: PageviewsGranularity;
  timestamp: string;
  access: PageviewsAccess;
  agent: PageviewsAgent;
  views: number;
};

type PageviewsResponse = { items: PageviewItem[] };

export type WikimediaPageviewsClientOptions = {
  userAgent: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class WikimediaApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly responseBody?: unknown;

  constructor(options: {
    message: string;
    status: number;
    url: string;
    responseBody?: unknown;
  }) {
    super(options.message);
    this.name = "WikimediaApiError";
    this.status = options.status;
    this.url = options.url;
    this.responseBody = options.responseBody;
  }
}

export class WikimediaPageviewsClient {
  private readonly userAgent: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: WikimediaPageviewsClientOptions) {
    if (!options.userAgent.trim()) {
      throw new Error(
        "A descriptive Wikimedia User-Agent with contact information is required.",
      );
    }

    this.userAgent = options.userAgent;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  buildPerArticleUrl(request: PageviewsRequest): string {
    const access = request.access ?? "all-access";
    const agent = request.agent ?? "user";
    const granularity = request.granularity ?? "monthly";

    validateProject(request.project);
    validateArticle(request.article);
    validateDateRange(request.start, request.end, granularity);

    const segments = [
      "metrics",
      "pageviews",
      "per-article",
      request.project,
      access,
      agent,
      request.article,
      granularity,
      toApiDate(request.start, granularity, "start"),
      toApiDate(request.end, granularity, "end"),
    ].map(encodeURIComponent);

    return `${this.baseUrl}/${segments.join("/")}`;
  }

  async getPerArticlePageviews(
    request: PageviewsRequest,
  ): Promise<PageviewItem[]> {
    const url = this.buildPerArticleUrl(request);
    const response = await this.fetchImplementation(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const responseBody = await readJsonSafely(response);

    if (!response.ok) {
      throw new WikimediaApiError({
        message: buildApiErrorMessage(response.status, url),
        status: response.status,
        url,
        responseBody,
      });
    }

    if (!isPageviewsResponse(responseBody)) {
      throw new WikimediaApiError({
        message: "Wikimedia returned an unexpected pageviews response.",
        status: response.status,
        url,
        responseBody,
      });
    }

    return responseBody.items;
  }
}

function validateProject(project: string): void {
  if (!/^[a-z0-9-]+\.wikipedia\.org$/i.test(project)) {
    throw new Error(
      `Invalid Wikipedia project "${project}". Expected a value such as "en.wikipedia.org".`,
    );
  }
}

function validateArticle(article: string): void {
  if (!article.trim()) {
    throw new Error("Article title must not be empty.");
  }
}

function validateDateRange(
  start: string,
  end: string,
  granularity: PageviewsGranularity,
): void {
  const startDate = parseInputDate(start, granularity, "start");
  const endDate = parseInputDate(end, granularity, "end");

  if (startDate > endDate) {
    throw new Error(`Start date "${start}" must not be after end date "${end}".`);
  }
}

function toApiDate(
  value: string,
  granularity: PageviewsGranularity,
  boundary: "start" | "end",
): string {
  const date = parseInputDate(value, granularity, boundary);
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("");
}

function parseInputDate(
  value: string,
  granularity: PageviewsGranularity,
  boundary: "start" | "end",
): Date {
  const compactDateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(value);

  let year: number;
  let month: number;
  let day: number;

  if (compactDateMatch) {
    year = Number(compactDateMatch[1]);
    month = Number(compactDateMatch[2]);
    day = Number(compactDateMatch[3]);
  } else if (dateMatch) {
    year = Number(dateMatch[1]);
    month = Number(dateMatch[2]);
    day = Number(dateMatch[3]);
  } else if (monthMatch && granularity === "monthly") {
    year = Number(monthMatch[1]);
    month = Number(monthMatch[2]);
    day = boundary === "start" ? 1 : daysInMonth(year, month);
  } else {
    const expected =
      granularity === "monthly" ? "YYYY-MM or YYYY-MM-DD" : "YYYY-MM-DD";
    throw new Error(`Invalid date "${value}". Expected ${expected}.`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date "${value}".`);
  }

  return date;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildApiErrorMessage(status: number, url: string): string {
  if (status === 404) {
    return (
      "Wikimedia returned 404. This can mean zero page views, unavailable data, " +
      `or an invalid project/article combination. Request: ${url}`
    );
  }
  if (status === 429) {
    return "Wikimedia rate limit exceeded. Wait before retrying the request.";
  }
  return `Wikimedia request failed with HTTP ${status}. Request: ${url}`;
}

function isPageviewsResponse(value: unknown): value is PageviewsResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;

  return value.items.every(
    (item) =>
      isRecord(item) &&
      typeof item.project === "string" &&
      typeof item.article === "string" &&
      (item.granularity === "daily" || item.granularity === "monthly") &&
      typeof item.timestamp === "string" &&
      typeof item.access === "string" &&
      typeof item.agent === "string" &&
      typeof item.views === "number" &&
      Number.isFinite(item.views),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
