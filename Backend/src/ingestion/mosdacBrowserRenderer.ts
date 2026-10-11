import { chromium, Request } from "playwright";
import { CRAWLER_USER_AGENT, RobotsPolicy } from "./politeHttp";
import { isAllowedMosdacHost } from "./mosdacUrlPolicy";
import { env } from "../config/env";

const BROWSER_REQUEST_LIMIT = 40;
const BROWSER_IN_FLIGHT_LIMIT = 4;
const BROWSER_PAGE_TIMEOUT_MS = 45_000;
const DEFAULT_BROWSER_RESPONSE_BYTE_LIMIT = 20 * 1024 * 1024;
const MAX_RESPONSE_CANCELLATION_RESERVE_BYTES = 128 * 1024;

export interface BrowserRenderResult {
  html: string;
  finalUrl: string;
  requestCount: number;
  encodedResponseBytes: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Render one known JavaScript-dependent page under strict same-host limits. */
export async function renderMosdacPage(
  sourceUrl: string,
  policy: RobotsPolicy,
  minimumDelayMs: number,
  maxHtmlBytes: number,
  maxEncodedResponseBytes = DEFAULT_BROWSER_RESPONSE_BYTE_LIMIT,
  onResponseBytes?: (totalBytes: number) => void,
  onRequestCount?: (totalRequests: number) => void
): Promise<BrowserRenderResult> {
  if (!Number.isSafeInteger(maxEncodedResponseBytes) || maxEncodedResponseBytes < 1) {
    throw new Error("Browser encoded response byte limit must be a positive safe integer");
  }
  // Reserve room for response chunks already in flight when CDP delivers the
  // cancellation event. Small user-specified caps reserve half; larger caps
  // reserve at most 128 KiB. This reduces expected overshoot but cannot make
  // browser network transfer a strict byte firewall.
  const cancellationThreshold = maxEncodedResponseBytes - Math.min(
    MAX_RESPONSE_CANCELLATION_RESERVE_BYTES,
    Math.floor(maxEncodedResponseBytes / 2)
  );
  const source = new URL(sourceUrl);
  if (!isAllowedMosdacHost(source.hostname) || !policy.isAllowed(source)) {
    throw new Error("Browser rendering source is not allowed by host/robots policy");
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: env.MOSDAC_BROWSER_EXECUTABLE_PATH,
      timeout: 15_000,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not launch Chromium for JavaScript rendering. Install it with ` +
        `pnpm --filter astrolynx-api exec playwright install chromium, or set ` +
        `MOSDAC_BROWSER_EXECUTABLE_PATH to a Chrome/Chromium binary. ${detail}`
    );
  }
  let requestCount = 0;
  let encodedResponseBytes = 0;
  let responseByteBudgetExceeded = false;
  let responseByteBudgetReason: "declared_response_sizes" | "received_bytes" = "received_bytes";
  let nextRequestAt = 0;
  let requestQueue: Promise<void> = Promise.resolve();
  const pageDeadline = Date.now() + BROWSER_PAGE_TIMEOUT_MS;
  try {
    const context = await browser.newContext({ userAgent: CRAWLER_USER_AGENT });
    const page = await context.newPage();
    const inFlightRequests = new Set<Request>();
    const inFlightWaiters: Array<() => void> = [];
    const releaseRequest = (request: Request) => {
      if (!inFlightRequests.delete(request)) return;
      inFlightWaiters.shift()?.();
    };
    page.on("requestfinished", releaseRequest);
    page.on("requestfailed", releaseRequest);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    const pendingResponseBytes = new Map<string, { declared: number; received: number }>();
    const stopForByteBudget = (
      reason: "declared_response_sizes" | "received_bytes"
    ) => {
      if (responseByteBudgetExceeded) return;
      responseByteBudgetExceeded = true;
      responseByteBudgetReason = reason;
      void context.close().catch(() => undefined);
    };
    const projectedEncodedBytes = () => encodedResponseBytes +
      [...pendingResponseBytes.values()].reduce(
        (sum, response) => sum + Math.max(0, response.declared - response.received),
        0
      );
    cdp.on("Network.responseReceived", (event) => {
      const contentLength = Object.entries(event.response.headers).find(
        ([name]) => name.toLowerCase() === "content-length"
      )?.[1];
      const declared = Number(contentLength);
      if (Number.isSafeInteger(declared) && declared > 0) {
        pendingResponseBytes.set(event.requestId, { declared, received: 0 });
        if (projectedEncodedBytes() > cancellationThreshold) {
          stopForByteBudget("declared_response_sizes");
        }
      }
    });
    cdp.on("Network.dataReceived", (event) => {
      const received = Math.max(0, Math.floor(event.encodedDataLength));
      encodedResponseBytes += received;
      const pending = pendingResponseBytes.get(event.requestId);
      if (pending) pending.received += received;
      onResponseBytes?.(encodedResponseBytes);
      if (encodedResponseBytes > cancellationThreshold) stopForByteBudget("received_bytes");
      else if (projectedEncodedBytes() > cancellationThreshold) {
        stopForByteBudget("declared_response_sizes");
      }
    });
    cdp.on("Network.loadingFinished", (event) => pendingResponseBytes.delete(event.requestId));
    cdp.on("Network.loadingFailed", (event) => pendingResponseBytes.delete(event.requestId));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const requestUrl = new URL(request.url());

      if (["image", "media", "font"].includes(resourceType)) {
        await route.abort("blockedbyclient");
        return;
      }
      if (
        requestUrl.protocol !== "https:" ||
        requestUrl.hostname !== source.hostname ||
        !isAllowedMosdacHost(requestUrl.hostname) ||
        !policy.isAllowed(requestUrl)
      ) {
        await route.abort("blockedbyclient");
        return;
      }
      if (responseByteBudgetExceeded) {
        await route.abort("blockedbyclient");
        return;
      }
      requestCount += 1;
      onRequestCount?.(requestCount);
      if (requestCount > BROWSER_REQUEST_LIMIT) {
        await route.abort("blockedbyclient");
        return;
      }

      const scheduledRequest = requestQueue.then(async () => {
        while (inFlightRequests.size >= BROWSER_IN_FLIGHT_LIMIT) {
          await new Promise<void>((resolve) => inFlightWaiters.push(resolve));
        }
        if (responseByteBudgetExceeded) {
          await route.abort("blockedbyclient");
          return;
        }
        const waitMs = Math.max(0, nextRequestAt - Date.now());
        if (Date.now() + waitMs >= pageDeadline) {
          await route.abort("timedout");
          return;
        }
        if (waitMs > 0) await delay(waitMs);
        if (Date.now() >= pageDeadline) {
          await route.abort("timedout");
          return;
        }
        if (responseByteBudgetExceeded) {
          await route.abort("blockedbyclient");
          return;
        }
        nextRequestAt = Date.now() + Math.max(minimumDelayMs, policy.crawlDelayMs);
        inFlightRequests.add(request);
        try {
          await route.continue();
        } catch (error) {
          releaseRequest(request);
          throw error;
        }
      });
      requestQueue = scheduledRequest.catch(() => undefined);
      await scheduledRequest;
    });

    try {
      await page.goto(sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(1, pageDeadline - Date.now()),
      });
      await page.waitForFunction(
        () => {
          const text = document.body?.innerText.trim() ?? "";
          const hasUnresolvedTemplate = /\{\{[^{}]{1,160}\}\}/u.test(text);
          const hasTableRows = document.querySelectorAll("table tbody tr").length > 1;
          const hasEmptyState = /no (?:data|products|records|results) available|no results found/iu.test(text);
          const stillLoading = /\bloading(?:\.\.\.)?/iu.test(text);
          return !hasUnresolvedTemplate && text.length >= 80 &&
            (hasTableRows || hasEmptyState || !stillLoading);
        },
        undefined,
        { timeout: Math.max(1, pageDeadline - Date.now()) }
      );
    } catch (error) {
      if (responseByteBudgetExceeded) {
        throw new Error(
          `Browser encoded response cancellation threshold crossed (${responseByteBudgetReason}; received ${encodedResponseBytes}, trigger ${cancellationThreshold}, configured cap ${maxEncodedResponseBytes})`
        );
      }
      throw error;
    }
    if (responseByteBudgetExceeded) {
      throw new Error(
        `Browser encoded response cancellation threshold crossed (${responseByteBudgetReason}; received ${encodedResponseBytes}, trigger ${cancellationThreshold}, configured cap ${maxEncodedResponseBytes})`
      );
    }

    const renderedDocumentBytes = await page.evaluate(() =>
      new Blob([document.documentElement.outerHTML]).size
    );
    if (renderedDocumentBytes > maxHtmlBytes) {
      throw new Error(
        `Rendered HTML exceeds byte limit (${renderedDocumentBytes} > ${maxHtmlBytes})`
      );
    }

    const finalUrl = page.url();
    const final = new URL(finalUrl);
    if (
      final.hostname !== source.hostname ||
      !isAllowedMosdacHost(final.hostname) ||
      !policy.isAllowed(final)
    ) {
      throw new Error("Rendered page ended at a URL disallowed by host/robots policy");
    }
    return {
      html: await page.content(),
      finalUrl,
      requestCount,
      encodedResponseBytes,
    };
  } catch (error) {
    if (responseByteBudgetExceeded) {
      throw new Error(
        `Browser encoded response cancellation threshold crossed (${responseByteBudgetReason}; received ${encodedResponseBytes}, trigger ${cancellationThreshold}, configured cap ${maxEncodedResponseBytes})`
      );
    }
    throw error;
  } finally {
    await browser.close();
  }
}
