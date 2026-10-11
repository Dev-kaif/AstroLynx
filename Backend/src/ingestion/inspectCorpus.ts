import fs from "node:fs/promises";
import path from "node:path";
import { extractPdfPages } from "./pdfPages";

interface CorpusInspectOptions {
  directories: string[];
  maxDocuments: number;
  maxPagesPerPdf: number;
  maxBytesPerPdf: number;
  includePageTextSamples: boolean;
  samplePagePositions: boolean;
}

interface DocumentSummary {
  sourceFile: string;
  sizeBytes: number | null;
  totalPages: number | null;
  pagesProcessed: number;
  sampledPageNumbers?: number[];
  usable: number;
  review: number;
  reject: number;
  noTextLayerPages: number[];
  signals: Record<string, number>;
  pageSamples?: Array<{
    pageNumber: number;
    status: "usable" | "review" | "reject";
    score: number;
    signals: string[];
    textExcerpt: string;
    excerptTruncated: boolean;
  }>;
  error?: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

async function discoverPdfs(directories: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const directory of directories) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        files.push(path.join(directory, entry.name));
      }
    }
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

export async function inspectPdfCorpus(options: CorpusInspectOptions) {
  const paths = await discoverPdfs(options.directories);
  const selected = paths.slice(0, options.maxDocuments);
  const documents: DocumentSummary[] = [];
  const totals = {
    discoveredDocuments: paths.length,
    selectedDocuments: selected.length,
    documentsProcessed: 0,
    documentsFailed: 0,
    pagesProcessed: 0,
    usable: 0,
    review: 0,
    reject: 0,
    noTextLayer: 0,
    signals: {} as Record<string, number>,
  };

  for (const sourceFile of selected) {
    try {
      const report = await extractPdfPages(sourceFile, {
        maxPages: options.maxPagesPerPdf,
        maxBytes: options.maxBytesPerPdf,
        samplePagePositions: options.samplePagePositions,
      });
      const document: DocumentSummary = {
        sourceFile: path.relative(process.cwd(), sourceFile),
        sizeBytes: report.sizeBytes,
        totalPages: report.totalPages,
        pagesProcessed: report.pagesProcessed,
        ...(report.sampledPageNumbers
          ? { sampledPageNumbers: report.sampledPageNumbers }
          : {}),
        usable: 0,
        review: 0,
        reject: 0,
        noTextLayerPages: [],
        signals: {},
        ...(options.includePageTextSamples ? { pageSamples: [] } : {}),
      };

      for (const page of report.pages) {
        if (page.extractionStatus === "not_processed") continue;
        if (page.extractionStatus === "no_text_layer") {
          document.noTextLayerPages.push(page.pageNumber);
          totals.noTextLayer += 1;
        }
        if (!page.quality) continue;
        document[page.quality.status] += 1;
        totals[page.quality.status] += 1;
        if (document.pageSamples) {
          const excerptLimit = 1000;
          document.pageSamples.push({
            pageNumber: page.pageNumber,
            status: page.quality.status,
            score: page.quality.score,
            signals: page.quality.signals,
            textExcerpt: page.text.slice(0, excerptLimit),
            excerptTruncated: page.text.length > excerptLimit,
          });
        }
        for (const signal of page.quality.signals) {
          document.signals[signal] = (document.signals[signal] ?? 0) + 1;
          totals.signals[signal] = (totals.signals[signal] ?? 0) + 1;
        }
      }

      documents.push(document);
      totals.documentsProcessed += 1;
      totals.pagesProcessed += report.pagesProcessed;
    } catch (error) {
      documents.push({
        sourceFile: path.relative(process.cwd(), sourceFile),
        sizeBytes: null,
        totalPages: null,
        pagesProcessed: 0,
        usable: 0,
        review: 0,
        reject: 0,
        noTextLayerPages: [],
        signals: {},
        error: error instanceof Error ? error.message : String(error),
      });
      totals.documentsFailed += 1;
    }
  }

  return {
    mode: "inspect-only",
    embedded: false,
    generatedAt: new Date().toISOString(),
    qualityPolicyVersion: "page-text-quality-v2",
    provisionalThresholdNotice:
      "Page decisions are heuristics and are not calibrated for automatic ingestion.",
    sampleMethod: options.samplePagePositions
      ? "first, middle, and last page of each selected PDF; PDF page traversal is capped at 500 pages"
      : "first pages of each selected PDF",
    limits: {
      maxDocuments: options.maxDocuments,
      maxPagesPerPdf: options.samplePagePositions
        ? 500
        : options.maxPagesPerPdf,
      requestedMaxPagesPerPdf: options.maxPagesPerPdf,
      maxBytesPerPdf: options.maxBytesPerPdf,
      includePageTextSamples: options.includePageTextSamples,
      samplePagePositions: options.samplePagePositions,
      inputDirectories: options.directories.map((directory) =>
        path.relative(process.cwd(), directory)
      ),
    },
    totals,
    documents,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const allAfter = (flag: string): string[] =>
    args.flatMap((arg, index) =>
      arg === flag && args[index + 1] ? [args[index + 1]!] : []
    );

  const directories = (allAfter("--input-dir").length
    ? allAfter("--input-dir")
    : ["downloaded_docs", "mosac-data"]
  ).map((directory) => path.resolve(directory));
  const maxDocuments = positiveInteger(valueAfter("--max-documents"), 100);
  const maxPagesPerPdf = positiveInteger(valueAfter("--max-pages-per-pdf"), 8);
  const maxBytesPerPdf = positiveInteger(
    valueAfter("--max-bytes-per-pdf"),
    50 * 1024 * 1024
  );
  if (maxDocuments > 1000) throw new Error("--max-documents cannot exceed 1000");
  if (maxPagesPerPdf > 500) throw new Error("--max-pages-per-pdf cannot exceed 500");
  if (maxBytesPerPdf > 500 * 1024 * 1024) {
    throw new Error("--max-bytes-per-pdf cannot exceed 524288000");
  }

  const report = await inspectPdfCorpus({
    directories,
    maxDocuments,
    maxPagesPerPdf,
    maxBytesPerPdf,
    includePageTextSamples: args.includes("--include-page-text-samples"),
    samplePagePositions: args.includes("--sample-page-positions"),
  });
  const outputPath = valueAfter("--output");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(serialized);
    return;
  }

  const resolvedOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  const handle = await fs.open(resolvedOutput, "wx");
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  process.stdout.write(`${JSON.stringify({ reportPath: resolvedOutput, ...report.totals }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
