import path from "node:path";
import { MOSDAC_SEEDS, crawlMosdac } from "./mosdacCrawler";
import { canonicalizeMosdacUrl } from "./mosdacUrlPolicy";

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const seeds = args
    .flatMap((arg, index) => (arg === "--seed-url" ? [args[index + 1]] : []))
    .filter((value): value is string => Boolean(value))
    .map((value) => canonicalizeMosdacUrl(value));
  const execute = args.includes("--execute");
  const maxRequests = positiveInteger(valueAfter("--max-requests"), 100);
  const maxDepth = nonNegativeInteger(valueAfter("--max-depth"), 2);
  const minDelayMs = positiveInteger(valueAfter("--delay-ms"), 1000);
  const maxBrowserPages = positiveInteger(valueAfter("--max-render-pages"), 3);
  const maxBrowserResponseBytes = positiveInteger(
    valueAfter("--max-render-bytes"),
    20 * 1024 * 1024
  );
  if (maxBrowserResponseBytes > 100 * 1024 * 1024) {
    throw new Error("--max-render-bytes cannot exceed 104857600");
  }
  const renderJavaScript = args.includes("--render-js");
  const outputDirectory = path.resolve(
    valueAfter("--output-dir") ??
      path.join(process.cwd(), "storage", "mosdac-crawl")
  );
  const effectiveSeeds = seeds.length > 0 ? seeds : MOSDAC_SEEDS;

  if (!execute) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "dry-run",
          networkRequestsMade: false,
          maxRequests,
          maxDepth,
          minimumDelayMs: minDelayMs,
          renderJavaScript,
          maxBrowserPages: renderJavaScript ? maxBrowserPages : 0,
          maxBrowserResponseBytes: renderJavaScript ? maxBrowserResponseBytes : 0,
          outputDirectory,
          seedUrls: effectiveSeeds,
          executeHint:
            "Add --execute to fetch. The crawler checks robots.txt and exact-host redirects, applies top-level and optional browser-render request/byte caps, and saves resumable records locally.",
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const summary = await crawlMosdac({
    seedUrls: effectiveSeeds,
    maxRequests,
    maxDepth,
    minDelayMs,
    renderJavaScript,
    maxBrowserPages,
    maxBrowserResponseBytes,
    outputDirectory,
    retryFailed: args.includes("--retry-failed"),
    refreshSeeds: args.includes("--refresh-seeds"),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
