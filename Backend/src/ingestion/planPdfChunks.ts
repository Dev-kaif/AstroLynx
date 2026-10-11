import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { extractPdfPages } from "./pdfPages";

export interface PlannedPdfChunk {
  id: string;
  sourceId: string;
  sourceFile: string;
  title: string;
  pageNumber: number;
  chunkNumber: number;
  characterCount: number;
  estimatedTokens: number;
  text: string;
}

export interface PdfChunkPlanOptions {
  directories: string[];
  maxDocuments: number;
  maxPagesPerPdf: number;
  maxBytesPerPdf: number;
  maxTotalPages: number;
  maxTotalBytes: number;
  maxTotalTokens: number;
  chunkCharacters: number;
  overlapCharacters: number;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function splitLongUnit(value: string, maximum: number): string[] {
  const parts: string[] = [];
  let rest = value;
  while (rest.length > maximum) {
    let boundary = rest.lastIndexOf(" ", maximum);
    if (boundary < Math.floor(maximum * 0.6)) boundary = maximum;
    parts.push(rest.slice(0, boundary).trim());
    rest = rest.slice(boundary).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Build reviewable, page-scoped chunks from usable text only; never embeds or writes an index. */
export function chunkPdfPage(text: string, maximum: number, overlap: number): string[] {
  const units = text
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => splitLongUnit(line, maximum));
  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    const next = current ? `${current}\n${unit}` : unit;
    if (next.length <= maximum) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    const carry = current.slice(Math.max(0, current.length - overlap)).trim();
    current = carry ? `${carry}\n${unit}` : unit;
    if (current.length > maximum) {
      const pieces = splitLongUnit(current, maximum);
      chunks.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function discoverPdfs(directories: string[]): Promise<string[]> {
  const found: string[] = [];
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
        found.push(path.join(directory, entry.name));
      }
    }
  }
  return [...new Set(found)].sort((a, b) => a.localeCompare(b));
}

export async function createPdfChunkPlan(options: PdfChunkPlanOptions) {
  if (!Number.isInteger(options.maxDocuments) || options.maxDocuments < 1 || options.maxDocuments > 100) {
    throw new Error("maxDocuments must be between 1 and 100");
  }
  if (!Number.isInteger(options.maxPagesPerPdf) || options.maxPagesPerPdf < 1 || options.maxPagesPerPdf > 500) {
    throw new Error("maxPagesPerPdf must be between 1 and 500");
  }
  if (!Number.isInteger(options.maxTotalPages) || options.maxTotalPages < 1 || options.maxTotalPages > 20_000) {
    throw new Error("maxTotalPages must be between 1 and 20000");
  }
  if (!Number.isSafeInteger(options.maxTotalBytes) || options.maxTotalBytes < 1 || options.maxTotalBytes > 5 * 1024 * 1024 * 1024) {
    throw new Error("maxTotalBytes must be between 1 and 5368709120");
  }
  if (!Number.isSafeInteger(options.maxTotalTokens) || options.maxTotalTokens < 1 || options.maxTotalTokens > 2_000_000) {
    throw new Error("maxTotalTokens must be between 1 and 2000000");
  }
  if (!Number.isSafeInteger(options.maxBytesPerPdf) || options.maxBytesPerPdf < 1 || options.maxBytesPerPdf > 500 * 1024 * 1024) {
    throw new Error("maxBytesPerPdf must be between 1 and 524288000");
  }
  if (options.chunkCharacters < 500 || options.chunkCharacters > 12_000) {
    throw new Error("chunkCharacters must be between 500 and 12000");
  }
  if (options.overlapCharacters < 0 || options.overlapCharacters >= options.chunkCharacters / 2) {
    throw new Error("overlapCharacters must be non-negative and less than half the chunk size");
  }
  if (!Number.isInteger(options.overlapCharacters)) throw new Error("overlapCharacters must be an integer");
  const discovered = await discoverPdfs(options.directories);
  const selected = discovered.slice(0, options.maxDocuments);
  const chunks: PlannedPdfChunk[] = [];
  const documents: Array<Record<string, unknown>> = [];
  const canonicalSourceByHash = new Map<string, string>();
  let totalPagesProcessed = 0;
  let totalBytesProcessed = 0;
  let acceptedPages = 0;
  let skippedPages = 0;
  let tokenBudgetSkippedPages = 0;
  let totalEstimatedTokens = 0;
  let failedDocuments = 0;
  let budgetSkippedDocuments = 0;

  for (const absolutePath of selected) {
    const sourceFile = path.relative(process.cwd(), absolutePath);
    const firstChunkIndex = chunks.length;
    try {
      if (totalEstimatedTokens >= options.maxTotalTokens) {
        budgetSkippedDocuments += 1;
        documents.push({ sourceFile, skipped: true, skipReason: "total_token_budget_exhausted" });
        continue;
      }
      if (totalPagesProcessed >= options.maxTotalPages) {
        budgetSkippedDocuments += 1;
        documents.push({ sourceFile, skipped: true, skipReason: "total_page_budget_exhausted" });
        continue;
      }
      const stat = await fs.stat(absolutePath);
      const remainingBytes = options.maxTotalBytes - totalBytesProcessed;
      if (stat.size > remainingBytes) {
        budgetSkippedDocuments += 1;
        documents.push({ sourceFile, skipped: true, sizeBytes: stat.size, skipReason: "total_byte_budget_exceeded" });
        continue;
      }
      const acceptedPagesBefore = acceptedPages;
      const skippedPagesBefore = skippedPages;
      const tokenBudgetSkippedBefore = tokenBudgetSkippedPages;
      const acceptedPageNumbers: number[] = [];
      // Reserve the full file size before extraction so a malformed PDF that
      // fails parsing cannot let later files reuse its aggregate byte budget.
      totalBytesProcessed += stat.size;
      let duplicateOf: string | undefined;
      const report = await extractPdfPages(absolutePath, {
        maxPages: Math.min(options.maxPagesPerPdf, options.maxTotalPages - totalPagesProcessed),
        maxBytes: options.maxBytesPerPdf,
        shouldSkipContentHash: (contentHash) => {
          duplicateOf = canonicalSourceByHash.get(contentHash);
          return duplicateOf !== undefined;
        },
      });
      const sourceId = report.contentHash;
      if (report.duplicateContentSkipped && duplicateOf) {
        documents.push({
          sourceId,
          sourceFile,
          duplicateOf,
          skipped: true,
          skipReason: "duplicate_pdf_content",
          sizeBytes: report.sizeBytes,
          pagesProcessed: 0,
          pageParsingSkipped: true,
          chunkCount: 0,
        });
        continue;
      }
      canonicalSourceByHash.set(sourceId, sourceFile);
      const sourceTitle = report.title ?? path.basename(sourceFile, path.extname(sourceFile));
      totalPagesProcessed += report.pagesProcessed;
      for (const page of report.pages.slice(0, report.pagesProcessed)) {
        if (page.quality?.status !== "usable") {
          skippedPages += 1;
          continue;
        }
        const pageChunks = chunkPdfPage(page.text, options.chunkCharacters, options.overlapCharacters);
        const pageEstimatedTokens = pageChunks.reduce(
          (sum, text) => sum + Math.ceil(text.length / 4),
          0
        );
        if (pageEstimatedTokens > options.maxTotalTokens - totalEstimatedTokens) {
          tokenBudgetSkippedPages += 1;
          skippedPages += 1;
          continue;
        }
        acceptedPages += 1;
        acceptedPageNumbers.push(page.pageNumber);
        pageChunks.forEach((text, chunkNumber) => {
          const identity = `${sourceId}\0${page.pageNumber}\0${chunkNumber}\0${text}`;
          const estimatedTokens = Math.ceil(text.length / 4);
          totalEstimatedTokens += estimatedTokens;
          chunks.push({
            id: hash(identity),
            sourceId,
            sourceFile,
            title: sourceTitle,
            pageNumber: page.pageNumber,
            chunkNumber,
            characterCount: text.length,
            estimatedTokens,
            text,
          });
        });
      }
      documents.push({
        sourceId,
        sourceFile,
        sizeBytes: report.sizeBytes,
        totalPages: report.totalPages,
        pagesProcessed: report.pagesProcessed,
        truncatedByPageLimit: report.truncatedByPageLimit,
        acceptedPages: acceptedPages - acceptedPagesBefore,
        acceptedPageNumbers,
        skippedPages: skippedPages - skippedPagesBefore,
        tokenBudgetSkippedPages: tokenBudgetSkippedPages - tokenBudgetSkippedBefore,
        chunkCount: chunks.length - firstChunkIndex,
      });
    } catch (error) {
      failedDocuments += 1;
      documents.push({ sourceFile, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    mode: "chunk-plan-dry-run",
    embedded: false,
    indexWritten: false,
    generatedAt: new Date().toISOString(),
    qualityPolicyVersion: "page-text-quality-v2",
    qualityGate: "Only pages assessed as usable are chunked; review/reject/no-text pages are excluded.",
    calibrationNotice: "Usable status is a provisional heuristic, not an approved bulk-ingestion threshold.",
    chunking: { strategy: "line-preserving, page-scoped character budget", maxCharacters: options.chunkCharacters, overlapCharacters: options.overlapCharacters, tokenEstimate: "ceil(characters / 4); planning estimate only" },
    limits: { discoveredDocuments: discovered.length, selectedDocuments: selected.length, maxDocuments: options.maxDocuments, maxPagesPerPdf: options.maxPagesPerPdf, maxBytesPerPdf: options.maxBytesPerPdf, maxTotalPages: options.maxTotalPages, maxTotalBytes: options.maxTotalBytes, maxTotalTokens: options.maxTotalTokens, duplicatePolicy: "same SHA-256 content is planned once; later paths point to the canonical first path" },
    totals: {
      documentsProcessed: documents.length - failedDocuments - budgetSkippedDocuments,
      documentsFailed: failedDocuments,
      documentsSkippedByBudget: budgetSkippedDocuments,
      duplicateDocumentsSkipped: documents.filter(
        (document) => document.skipReason === "duplicate_pdf_content"
      ).length,
      pagesProcessed: totalPagesProcessed,
      bytesCountedAgainstBudget: totalBytesProcessed,
      acceptedPages,
      skippedPages,
      tokenBudgetSkippedPages,
      chunks: chunks.length,
      estimatedTokens: totalEstimatedTokens,
    },
    documents,
    chunks,
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const directories = args.flatMap((arg, index) => arg === "--input-dir" && args[index + 1]
    ? [path.resolve(args[index + 1]!)] : []);
  const report = await createPdfChunkPlan({
    directories: directories.length ? directories : [path.resolve("downloaded_docs"), path.resolve("mosac-data")],
    maxDocuments: positiveInteger(valueAfter("--max-documents"), 5),
    maxPagesPerPdf: positiveInteger(valueAfter("--max-pages-per-pdf"), 8),
    maxBytesPerPdf: positiveInteger(valueAfter("--max-bytes-per-pdf"), 50 * 1024 * 1024),
    maxTotalPages: positiveInteger(valueAfter("--max-total-pages"), 2000),
    maxTotalBytes: positiveInteger(valueAfter("--max-total-bytes"), 1024 * 1024 * 1024),
    maxTotalTokens: positiveInteger(valueAfter("--max-total-tokens"), 200_000),
    chunkCharacters: positiveInteger(valueAfter("--chunk-characters"), 3500),
    overlapCharacters: valueAfter("--overlap-characters") === undefined
      ? 350 : Number(valueAfter("--overlap-characters")),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = valueAfter("--output");
  if (!outputPath) {
    process.stdout.write(serialized);
    return;
  }
  const destination = path.resolve(outputPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const handle = await fs.open(destination, "wx");
  try { await handle.writeFile(serialized, "utf8"); } finally { await handle.close(); }
  process.stdout.write(`${JSON.stringify({ reportPath: destination, ...report.totals }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
