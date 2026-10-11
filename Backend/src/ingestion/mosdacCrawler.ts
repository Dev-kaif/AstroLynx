import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractHtmlPage, extractXmlFeed } from "./htmlExtractor";
import { assessExtractedText } from "./textQuality";
import { renderMosdacPage } from "./mosdacBrowserRenderer";
import { extractMosdacCatalog } from "./mosdacCatalog";
import { persistFeedSnapshot } from "./feedEntryStore";
import { acquireFileLock } from "./fileLock";
import {
  fetchWithRetry,
  loadRobotsPolicy,
  readBoundedBody,
  RobotsPolicy,
} from "./politeHttp";
import {
  canonicalizeMosdacUrl,
  isCandidateMosdacUrl,
  shouldSkipAssetUrl,
} from "./mosdacUrlPolicy";

export const MOSDAC_SEEDS = [
  "https://mosdac.gov.in/catalog/satellite?language=en",
  "https://mosdac.gov.in/catalog/radar.php",
  "https://mosdac.gov.in/rss-feed",
  "https://mosdac.gov.in/isrocast.xml",
  "https://mosdac.gov.in/3dimager.xml",
  "https://mosdac.gov.in/3dsounder.xml",
  "https://mosdac.gov.in/3drimager.xml",
  "https://mosdac.gov.in/3drsounder.xml",
];

const STATE_VERSION = 1;
const MAX_QUEUE_SIZE = 10_000;
const MAX_FAILURES = 2_000;
const HTML_MAX_BYTES = 5 * 1024 * 1024;
const PDF_MAX_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_BROWSER_PAGE_BUDGET = 3;
const MAX_BROWSER_PAGE_BUDGET = 10;
const DEFAULT_BROWSER_RESPONSE_BYTE_BUDGET = 20 * 1024 * 1024;
const MAX_BROWSER_RESPONSE_BYTE_BUDGET = 100 * 1024 * 1024;

interface QueueEntry {
  url: string;
  depth: number;
  discoveredFrom: string | null;
}

interface FailedEntry {
  entry: QueueEntry;
  reason: string;
  failedAt: string;
}

interface CrawlState {
  version: 1;
  queue: QueueEntry[];
  seen: string[];
  completed: string[];
  failed: FailedEntry[];
  validators: Record<string, { etag?: string; lastModified?: string }>;
  savedBytes: number;
  startedAt: string;
  updatedAt: string;
}

export interface MosdacCrawlOptions {
  seedUrls?: string[];
  maxRequests?: number;
  maxDepth?: number;
  minDelayMs?: number;
  maxHtmlBytes?: number;
  maxPdfBytes?: number;
  outputDirectory?: string;
  retryFailed?: boolean;
  refreshSeeds?: boolean;
  renderJavaScript?: boolean;
  maxBrowserPages?: number;
  maxBrowserResponseBytes?: number;
}

export interface MosdacCrawlSummary {
  requestsThisRun: number;
  htmlPagesSaved: number;
  feedsSaved: number;
  feedEntryRecordsCreated: number;
  feedEntryRecordsUpdated: number;
  feedEntryRecordsUnchanged: number;
  feedEntryRecordsMarkedInactive: number;
  feedSnapshotsNotReconciled: number;
  pdfFilesSaved: number;
  unchangedResponses: number;
  unsupportedResponses: number;
  blockedByRobots: number;
  failuresThisRun: number;
  failedTotal: number;
  browserPagesAttempted: number;
  browserPagesRendered: number;
  browserRenderFailures: number;
  browserRequestsThisRun: number;
  browserEncodedResponseBytesThisRun: number;
  queueRemaining: number;
  completedTotal: number;
  savedBytesTotal: number;
  outputDirectory: string;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeAtomic(filePath: string, contents: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, contents, { flag: "wx" });
  await fs.rename(temporaryPath, filePath);
}

async function loadState(statePath: string, seedEntries: QueueEntry[]): Promise<CrawlState> {
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as CrawlState;
    if (
      parsed.version !== STATE_VERSION ||
      !Array.isArray(parsed.queue) ||
      !Array.isArray(parsed.seen) ||
      !Array.isArray(parsed.completed) ||
      !Array.isArray(parsed.failed) ||
      typeof parsed.validators !== "object"
    ) {
      throw new Error("Unsupported or malformed crawl-state file");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const now = new Date().toISOString();
    return {
      version: STATE_VERSION,
      queue: seedEntries,
      seen: seedEntries.map((entry) => entry.url),
      completed: [],
      failed: [],
      validators: {},
      savedBytes: 0,
      startedAt: now,
      updatedAt: now,
    };
  }
}

async function saveState(statePath: string, state: CrawlState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*["']?([^;\s"']+)/iu.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function isHtmlType(contentType: string): boolean {
  return /(?:text\/html|application\/xhtml\+xml)/iu.test(contentType);
}

function isXmlType(contentType: string): boolean {
  return /(?:application\/(?:rss|atom)\+xml|application\/xml|text\/xml)/iu.test(
    contentType
  );
}

function pageId(url: string): string {
  return sha256(url).slice(0, 40);
}

function clearFailureForUrl(state: CrawlState, url: string): void {
  state.failed = state.failed.filter((failure) => failure.entry.url !== url);
}

function enqueueLinks(
  links: string[],
  source: QueueEntry,
  state: CrawlState,
  seenUrls: Set<string>,
  maxDepth: number
): void {
  if (source.depth >= maxDepth) return;
  for (const link of links) {
    if (state.queue.length >= MAX_QUEUE_SIZE) break;
    try {
      const url = canonicalizeMosdacUrl(link, source.url);
      if (
        shouldSkipAssetUrl(url) ||
        !isCandidateMosdacUrl(url) ||
        seenUrls.has(url)
      ) continue;
      state.seen.push(url);
      seenUrls.add(url);
      state.queue.push({ url, depth: source.depth + 1, discoveredFrom: source.url });
    } catch {
      // Invalid/external URLs are deliberately ignored.
    }
  }
}

async function ensureRobotsPolicy(
  hostname: string,
  policies: Map<string, RobotsPolicy>
): Promise<RobotsPolicy> {
  const cached = policies.get(hostname);
  if (cached) return cached;
  const policy = await loadRobotsPolicy(hostname);
  policies.set(hostname, policy);
  return policy;
}

function validatorsFor(state: CrawlState, url: string): HeadersInit {
  const validators = state.validators[url];
  if (!validators) return {};
  const headers: Record<string, string> = {};
  if (validators.etag) headers["If-None-Match"] = validators.etag;
  if (validators.lastModified) headers["If-Modified-Since"] = validators.lastModified;
  return headers;
}

export async function crawlMosdac(
  options: MosdacCrawlOptions = {}
): Promise<MosdacCrawlSummary> {
  const maxRequests = options.maxRequests ?? 100;
  const maxDepth = options.maxDepth ?? 2;
  const minDelayMs = options.minDelayMs ?? 1000;
  const maxHtmlBytes = options.maxHtmlBytes ?? HTML_MAX_BYTES;
  const maxPdfBytes = options.maxPdfBytes ?? PDF_MAX_BYTES;
  const maxBrowserResponseBytes = options.maxBrowserResponseBytes ?? DEFAULT_BROWSER_RESPONSE_BYTE_BUDGET;
  const outputDirectory = path.resolve(
    options.outputDirectory ?? path.join(process.cwd(), "storage", "mosdac-crawl")
  );

  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) {
    throw new Error("maxRequests must be between 1 and 1000");
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 5) {
    throw new Error("maxDepth must be between 0 and 5");
  }
  if (!Number.isInteger(minDelayMs) || minDelayMs < 1000 || minDelayMs > 60_000) {
    throw new Error("minDelayMs must be between 1000 and 60000");
  }
  const maxBrowserPages = options.maxBrowserPages ?? DEFAULT_BROWSER_PAGE_BUDGET;
  if (
    !Number.isInteger(maxBrowserPages) ||
    maxBrowserPages < 1 ||
    maxBrowserPages > MAX_BROWSER_PAGE_BUDGET
  ) {
    throw new Error(`maxBrowserPages must be between 1 and ${MAX_BROWSER_PAGE_BUDGET}`);
  }
  if (
    !Number.isSafeInteger(maxBrowserResponseBytes) ||
    maxBrowserResponseBytes < 1 ||
    maxBrowserResponseBytes > MAX_BROWSER_RESPONSE_BYTE_BUDGET
  ) {
    throw new Error(`maxBrowserResponseBytes must be between 1 and ${MAX_BROWSER_RESPONSE_BYTE_BUDGET}`);
  }

  const seedUrls = (options.seedUrls ?? MOSDAC_SEEDS).map((url) =>
    canonicalizeMosdacUrl(url)
  );
  const statePath = path.join(outputDirectory, "state.json");
  const seedEntries = seedUrls.map((url) => ({
    url,
    depth: 0,
    discoveredFrom: null,
  }));
  const releaseCrawlLock = await acquireFileLock(path.join(outputDirectory, ".crawl.lock"));
  try {
  const state = await loadState(statePath, seedEntries);
  const seen = new Set(state.seen);
  const completed = new Set(state.completed);

  for (const seed of seedEntries) {
    if (options.refreshSeeds && !state.queue.some((entry) => entry.url === seed.url)) {
      state.queue.push(seed);
    } else if (!seen.has(seed.url)) {
      state.queue.push(seed);
      state.seen.push(seed.url);
      seen.add(seed.url);
    }
  }
  if (options.retryFailed) {
    for (const failure of state.failed.splice(0)) {
      if (!state.queue.some((entry) => entry.url === failure.entry.url)) {
        state.queue.push(failure.entry);
      }
    }
  }

  const summary: MosdacCrawlSummary = {
    requestsThisRun: 0,
    htmlPagesSaved: 0,
    feedsSaved: 0,
    feedEntryRecordsCreated: 0,
    feedEntryRecordsUpdated: 0,
    feedEntryRecordsUnchanged: 0,
    feedEntryRecordsMarkedInactive: 0,
    feedSnapshotsNotReconciled: 0,
    pdfFilesSaved: 0,
    unchangedResponses: 0,
    unsupportedResponses: 0,
    blockedByRobots: 0,
    failuresThisRun: 0,
    failedTotal: state.failed.length,
    browserPagesAttempted: 0,
    browserPagesRendered: 0,
    browserRenderFailures: 0,
    browserRequestsThisRun: 0,
    browserEncodedResponseBytesThisRun: 0,
    queueRemaining: 0,
    completedTotal: completed.size,
    savedBytesTotal: state.savedBytes,
    outputDirectory,
  };
  const robotsPolicies = new Map<string, RobotsPolicy>();
  const lastRequestAt = new Map<string, number>();

  while (state.queue.length > 0 && summary.requestsThisRun < maxRequests) {
    const entry = state.queue.shift()!;
    const url = new URL(entry.url);
    let policy: RobotsPolicy;
    try {
      policy = await ensureRobotsPolicy(url.hostname, robotsPolicies);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.failed.push({ entry, reason, failedAt: new Date().toISOString() });
      summary.failuresThisRun += 1;
      summary.failedTotal = state.failed.length;
      await saveState(statePath, state);
      throw new Error(`Crawler stopped because robots.txt could not be verified: ${reason}`);
    }

    if (!policy.isAllowed(url)) {
      summary.blockedByRobots += 1;
      clearFailureForUrl(state, entry.url);
      summary.failedTotal = state.failed.length;
      completed.add(entry.url);
      state.completed = [...completed];
      await saveState(statePath, state);
      continue;
    }

    const host = url.hostname;
    const requiredDelay = Math.max(minDelayMs, policy.crawlDelayMs);
    if (!lastRequestAt.has(host)) lastRequestAt.set(host, Date.now());
    const waitMs = Math.max(0, (lastRequestAt.get(host) ?? 0) + requiredDelay - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt.set(host, Date.now());

    summary.requestsThisRun += 1;
    const id = pageId(entry.url);
    try {
      const { response, finalUrl } = await fetchWithRetry(
        entry.url,
        validatorsFor(state, entry.url),
        3,
        REQUEST_TIMEOUT_MS,
        (target) => target.hostname === host && policy.isAllowed(target)
      );

      if (response.status === 304) {
        summary.unchangedResponses += 1;
        clearFailureForUrl(state, entry.url);
        summary.failedTotal = state.failed.length;
        completed.add(entry.url);
        state.completed = [...completed];
        await saveState(statePath, state);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const supportedResponse =
        isHtmlType(contentType) ||
        isXmlType(contentType) ||
        /application\/pdf|application\/octet-stream/iu.test(contentType) ||
        contentType.length === 0;
      if (!supportedResponse) {
        await response.body?.cancel();
        summary.unsupportedResponses += 1;
        clearFailureForUrl(state, entry.url);
        summary.failedTotal = state.failed.length;
        completed.add(entry.url);
        state.completed = [...completed];
        await writeAtomic(
          path.join(outputDirectory, "records", `${id}.json`),
          `${JSON.stringify(
            {
              sourceId: id,
              requestedUrl: entry.url,
              finalUrl,
              discoveredFrom: entry.discoveredFrom,
              depth: entry.depth,
              fetchedAt: new Date().toISOString(),
              contentType,
              extractionStatus: "unsupported_content_type",
              embedded: false,
            },
            null,
            2
          )}\n`
        );
        state.completed = [...completed];
        await saveState(statePath, state);
        continue;
      }
      const responseLimit =
        /pdf|application\/octet-stream/iu.test(contentType) || !contentType
          ? maxPdfBytes
          : maxHtmlBytes;
      const bytes = await readBoundedBody(response, responseLimit);
      const contentHash = sha256(bytes);
      const fetchedAt = new Date().toISOString();
      const etag = response.headers.get("etag") ?? undefined;
      const lastModified = response.headers.get("last-modified") ?? undefined;

      if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") {
        const fileName = `${id}.pdf`;
        await writeAtomic(path.join(outputDirectory, "documents", fileName), bytes);
        await writeAtomic(
          path.join(outputDirectory, "records", `${id}.json`),
          `${JSON.stringify(
            {
              sourceId: id,
              requestedUrl: entry.url,
              finalUrl,
              discoveredFrom: entry.discoveredFrom,
              depth: entry.depth,
              fetchedAt,
              contentType,
              sizeBytes: bytes.byteLength,
              contentHash,
              filePath: path.posix.join("documents", fileName),
              extractionStatus: "pending_quality_inspection",
              embedded: false,
            },
            null,
            2
          )}\n`
        );
        summary.pdfFilesSaved += 1;
      } else if (isHtmlType(contentType) || isXmlType(contentType)) {
        const rawText = decodeText(bytes, contentType);
        const isFeed = isXmlType(contentType);
        let extracted = isFeed
          ? extractXmlFeed(rawText, finalUrl)
          : extractHtmlPage(rawText, finalUrl);
        let renderedHtml: string | undefined;
        let renderedFinalUrl: string | undefined;
        let browserRequestCount: number | undefined;
        let browserEncodedResponseBytes = 0;
        let accountedBrowserRequests = 0;
        let browserRenderStatus = "not_needed";
        let browserRenderError: string | undefined;
        if (!isFeed && extracted.extractionStatus === "needs_browser_render") {
          if (!options.renderJavaScript) {
            browserRenderStatus = "not_requested";
          } else if (summary.browserPagesAttempted >= maxBrowserPages) {
            browserRenderStatus = "budget_exhausted";
          } else {
            summary.browserPagesAttempted += 1;
            browserRenderStatus = "failed";
            try {
              // Keep the browser's document request within the same per-host
              // delay as ordinary crawler requests.
              const delayUntil =
                (lastRequestAt.get(host) ?? Date.now()) + requiredDelay;
              const renderWaitMs = Math.max(0, delayUntil - Date.now());
              if (renderWaitMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, renderWaitMs));
              }
              lastRequestAt.set(host, Date.now());
              const rendered = await renderMosdacPage(
                finalUrl,
                policy,
                requiredDelay,
                maxHtmlBytes,
                maxBrowserResponseBytes,
                (responseBytes) => {
                  summary.browserEncodedResponseBytesThisRun += responseBytes - browserEncodedResponseBytes;
                  browserEncodedResponseBytes = responseBytes;
                },
                (totalRequests) => {
                  summary.browserRequestsThisRun += totalRequests - accountedBrowserRequests;
                  accountedBrowserRequests = totalRequests;
                  browserRequestCount = totalRequests;
                }
              );
              renderedFinalUrl = rendered.finalUrl;
              browserRequestCount = rendered.requestCount;
              browserEncodedResponseBytes = rendered.encodedResponseBytes;
              if (Buffer.byteLength(rendered.html, "utf8") > maxHtmlBytes) {
                throw new Error(`Rendered HTML exceeds byte limit (${maxHtmlBytes})`);
              }
              renderedHtml = rendered.html;
              extracted = extractHtmlPage(renderedHtml, renderedFinalUrl, {
                javascriptRendered: true,
              });
              browserRenderStatus = extracted.extractionStatus === "needs_browser_render"
                ? "incomplete"
                : "rendered";
              if (browserRenderStatus === "rendered") {
                summary.browserPagesRendered += 1;
              } else {
                summary.browserRenderFailures += 1;
                browserRenderError = "Rendered response still contains unresolved JavaScript templates";
              }
            } catch (error) {
              summary.browserRenderFailures += 1;
              browserRenderError = error instanceof Error ? error.message : String(error);
            }
          }
        }
        const quality = assessExtractedText(extracted.text);
        const catalog = !isFeed
          ? extractMosdacCatalog(renderedHtml ?? rawText, renderedFinalUrl ?? finalUrl)
          : undefined;
        const extension = isFeed ? "xml" : "html";
        let renderedPath: string | undefined;
        let renderedContentHash: string | undefined;
        if (renderedHtml !== undefined) {
          renderedPath = path.posix.join("raw", `${id}.rendered.html`);
          const renderedBytes = Buffer.from(renderedHtml, "utf8");
          renderedContentHash = sha256(renderedBytes);
          await writeAtomic(path.join(outputDirectory, renderedPath), renderedBytes);
          state.savedBytes += renderedBytes.byteLength;
        }
        await writeAtomic(
          path.join(outputDirectory, "raw", `${id}.${extension}`),
          bytes
        );
        await writeAtomic(
          path.join(outputDirectory, "records", `${id}.json`),
          `${JSON.stringify(
            {
              sourceId: id,
              requestedUrl: entry.url,
              finalUrl,
              discoveredFrom: entry.discoveredFrom,
              depth: entry.depth,
              fetchedAt,
              contentType,
              etag,
              lastModified,
              sizeBytes: bytes.byteLength,
              contentHash,
              rawPath: path.posix.join("raw", `${id}.${extension}`),
              renderedPath,
              renderedFinalUrl,
              renderedContentHash,
              browserRequestCount,
              browserEncodedResponseBytes,
              browserRenderStatus,
              browserRenderError,
              contentKind: isFeed ? "feed" : "html",
              extractionPolicyVersion: "mosdac-static-html-v1",
              title: extracted.title,
              headings: extracted.headings,
              text: extracted.text,
              selectorUsed: extracted.selectorUsed,
              links: extracted.links,
              documentLinks: extracted.documentLinks,
              feedEntries: extracted.feedEntries ?? [],
              extractionStatus: extracted.extractionStatus === "needs_browser_render"
                ? "needs_browser_render"
                : "pending_quality_review",
              extractionSignals: extracted.extractionSignals,
              textQuality: quality,
              catalog,
              embedded: false,
            },
            null,
            2
          )}\n`
        );
        if (isFeed) {
          if (extracted.feedIsComplete && extracted.feedEntries?.length) {
            const persisted = await persistFeedSnapshot({
              outputDirectory,
              feedUrl: finalUrl,
              feedSourceId: id,
              fetchedAt,
              contentHash,
              entries: extracted.feedEntries,
            });
            summary.feedEntryRecordsCreated += persisted.newEntries;
            summary.feedEntryRecordsUpdated += persisted.updatedEntries;
            summary.feedEntryRecordsUnchanged += persisted.unchangedEntries;
            summary.feedEntryRecordsMarkedInactive += persisted.markedInactive;
          } else {
            summary.feedSnapshotsNotReconciled += 1;
          }
        }
        enqueueLinks(extracted.links, entry, state, seen, maxDepth);
        if (isFeed) summary.feedsSaved += 1;
        else summary.htmlPagesSaved += 1;
      } else {
        await response.body?.cancel();
        summary.unsupportedResponses += 1;
      }

      if (etag || lastModified) state.validators[entry.url] = { etag, lastModified };
      state.savedBytes += bytes.byteLength;
      summary.savedBytesTotal = state.savedBytes;
      completed.add(entry.url);
      clearFailureForUrl(state, entry.url);
      state.completed = [...completed];
      summary.completedTotal = completed.size;
      if (state.failed.length > MAX_FAILURES) {
        state.failed = state.failed.slice(-MAX_FAILURES);
      }
      summary.failedTotal = state.failed.length;
      await saveState(statePath, state);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.failed.push({ entry, reason, failedAt: new Date().toISOString() });
      summary.failuresThisRun += 1;
      if (state.failed.length > MAX_FAILURES) {
        state.failed = state.failed.slice(-MAX_FAILURES);
      }
      summary.failedTotal = state.failed.length;
      await saveState(statePath, state);
    }
  }

  summary.queueRemaining = state.queue.length;
  summary.completedTotal = completed.size;
  summary.savedBytesTotal = state.savedBytes;
  summary.failedTotal = state.failed.length;
  await saveState(statePath, state);
  return summary;
  } finally {
    await releaseCrawlLock();
  }
}
