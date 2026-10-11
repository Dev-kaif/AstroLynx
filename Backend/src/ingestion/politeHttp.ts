import { canonicalizeMosdacUrl, isAllowedMosdacHost } from "./mosdacUrlPolicy";

class NonRetryableFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableFetchError";
  }
}

export const CRAWLER_USER_AGENT = "AstroLynx-MOSDAC-Research/1.0";

export interface RobotsPolicy {
  crawlDelayMs: number;
  isAllowed(url: URL): boolean;
}

interface RobotsRule {
  allow: boolean;
  path: string;
  order: number;
}

function ruleRegex(path: string): RegExp {
  const anchored = path.endsWith("$");
  const pattern = anchored ? path.slice(0, -1) : path;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*/gu, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ".*"}`, "u");
}

export function parseRobotsPolicy(contents: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: RobotsRule[]; delay?: number }> = [];
  let current: (typeof groups)[number] | undefined;
  let order = 0;

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const directive = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (directive === "user-agent") {
      if (!current || current.rules.length > 0 || current.delay !== undefined) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && directive === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.delay = Math.min(60_000, Math.ceil(seconds * 1000));
      }
    } else if (current && (directive === "allow" || directive === "disallow")) {
      // An empty Disallow means that the whole site is allowed.
      if (value) {
        current.rules.push({ allow: directive === "allow", path: value, order });
        order += 1;
      }
    }
  }

  const matchingGroups = groups.filter((group) =>
    group.agents.some((agent) => agent === "*" || CRAWLER_USER_AGENT.toLowerCase().includes(agent))
  );
  const rules = matchingGroups.flatMap((group) => group.rules);
  const crawlDelayMs = Math.max(
    1000,
    ...matchingGroups.map((group) => group.delay ?? 0)
  );

  return {
    crawlDelayMs,
    isAllowed(url) {
      const target = `${url.pathname}${url.search}`;
      let matched: RobotsRule | undefined;
      for (const rule of rules) {
        if (!ruleRegex(rule.path).test(target)) continue;
        if (
          !matched ||
          rule.path.replace(/\*|\$/gu, "").length >
            matched.path.replace(/\*|\$/gu, "").length ||
          (rule.path.replace(/\*|\$/gu, "").length ===
            matched.path.replace(/\*|\$/gu, "").length &&
            rule.allow &&
            !matched.allow)
        ) {
          matched = rule;
        }
      }
      return matched?.allow ?? true;
    },
  };
}

export async function readBoundedBody(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Response exceeds byte limit (${declaredLength} > ${maxBytes})`);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds byte limit (${total} > ${maxBytes})`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export interface SafeFetchResponse {
  response: Response;
  finalUrl: string;
}

/** Follow a small number of redirects, validating every hop against exact hosts. */
export async function safeFetch(
  startUrl: string,
  headers: HeadersInit = {},
  timeoutMs = 15_000,
  allowRedirectTarget?: (target: URL) => boolean
): Promise<SafeFetchResponse> {
  let currentUrl = canonicalizeMosdacUrl(startUrl);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml,text/xml,application/pdf,*/*;q=0.2",
        ...Object.fromEntries(new Headers(headers).entries()),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new NonRetryableFetchError(`Redirect ${response.status} has no Location header`);
    if (redirectCount === 3) throw new NonRetryableFetchError("Redirect limit exceeded");
    let redirectedUrl: string;
    try {
      redirectedUrl = canonicalizeMosdacUrl(location, currentUrl);
    } catch (error) {
      throw new NonRetryableFetchError(error instanceof Error ? error.message : String(error));
    }
    const target = new URL(redirectedUrl);
    if (!isAllowedMosdacHost(target.hostname)) {
      throw new NonRetryableFetchError("Redirect left the MOSDAC host allowlist");
    }
    if (target.hostname !== new URL(currentUrl).hostname) {
      throw new NonRetryableFetchError("Cross-host redirects are not followed; crawl the target host after its robots policy is checked");
    }
    if (allowRedirectTarget && !allowRedirectTarget(target)) {
      throw new NonRetryableFetchError("Redirect target is disallowed by robots.txt");
    }
    currentUrl = redirectedUrl;
  }
  throw new Error("Redirect limit exceeded");
}

function retryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(60_000, Math.max(1000, seconds * 1000));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(60_000, Math.max(1000, date - Date.now()));
  }
  return Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Retry only rate limits, transient server failures, and transport errors. */
export async function fetchWithRetry(
  url: string,
  headers: HeadersInit = {},
  maxAttempts = 3,
  timeoutMs = 15_000,
  allowRedirectTarget?: (target: URL) => boolean
): Promise<SafeFetchResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response | undefined;
    try {
      const fetched = await safeFetch(url, headers, timeoutMs, allowRedirectTarget);
      response = fetched.response;
      const transient =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      if (!transient || attempt === maxAttempts) return fetched;
      await response.body?.cancel();
      await sleep(retryDelayMs(response, attempt));
    } catch (error) {
      if (error instanceof NonRetryableFetchError) throw error;
      if (error instanceof Error && error.name === "UrlPolicyError") throw error;
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await sleep(retryDelayMs(response, attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export async function loadRobotsPolicy(hostname: string): Promise<RobotsPolicy> {
  if (!isAllowedMosdacHost(hostname)) {
    throw new Error(`Cannot load robots.txt for unapproved host: ${hostname}`);
  }
  const robotsUrl = `https://${hostname}/robots.txt`;
  const { response } = await fetchWithRetry(robotsUrl, {}, 2, 10_000);
  if (response.status === 404) {
    await response.body?.cancel();
    return parseRobotsPolicy("");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Cannot verify robots.txt for ${hostname}: HTTP ${response.status}`);
  }
  const body = await readBoundedBody(response, 512 * 1024);
  return parseRobotsPolicy(new TextDecoder().decode(body));
}
