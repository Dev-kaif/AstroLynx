import path from "node:path";
import { extractPdfPages } from "./pdfPages";

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueFor = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };

  const inputPath = valueFor("--pdf");
  if (!inputPath || inputPath.startsWith("--")) {
    throw new Error(
      "Usage: pnpm --filter astrolynx-api ingest:inspect-pdf -- --pdf <path> [--max-pages 500] [--max-bytes 52428800]"
    );
  }

  const maxPages = readPositiveInteger(valueFor("--max-pages"), 500);
  const maxBytes = readPositiveInteger(valueFor("--max-bytes"), 50 * 1024 * 1024);
  const report = await extractPdfPages(path.resolve(inputPath), {
    maxPages,
    maxBytes,
  });

  const counts = {
    usable: report.pages.filter((page) => page.quality?.status === "usable")
      .length,
    review: report.pages.filter((page) => page.quality?.status === "review")
      .length,
    rejected: report.pages.filter((page) => page.quality?.status === "reject")
      .length,
    noTextLayer: report.pages.filter(
      (page) => page.extractionStatus === "no_text_layer"
    ).length,
    notProcessed: report.pages.filter(
      (page) => page.extractionStatus === "not_processed"
    ).length,
  };

  const inspected = report.pages.filter((page) => page.quality !== null);
  const samples = [
    ...inspected.filter((page) => page.quality?.status !== "usable").slice(0, 8),
    ...inspected.filter((page) => page.quality?.status === "usable").slice(0, 2),
  ].map((page) => ({
    pageNumber: page.pageNumber,
    extractionStatus: page.extractionStatus,
    quality: page.quality,
    textSample: page.text.slice(0, 360),
  }));

  // This is intentionally a dry-run report. No chunks or embeddings are made.
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "inspect-only",
        embedded: false,
        sourceFile: report.sourceFile,
        sizeBytes: report.sizeBytes,
        totalPages: report.totalPages,
        pagesProcessed: report.pagesProcessed,
        truncatedByPageLimit: report.truncatedByPageLimit,
        qualityPolicyVersion: "page-text-quality-v2",
        provisionalThresholdNotice:
          "Scores are heuristic and must be calibrated against labeled MOSDAC pages before bulk indexing.",
        counts,
        samples,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
