import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import {
  assessExtractedText,
  TextQualityAssessment,
} from "./textQuality";

export interface PdfPageExtraction {
  pageNumber: number;
  text: string;
  extractionStatus: "text_extracted" | "no_text_layer" | "not_processed";
  quality: TextQualityAssessment | null;
}

export interface PdfExtractionReport {
  sourceFile: string;
  title?: string;
  contentHash: string;
  sizeBytes: number;
  totalPages: number;
  pagesProcessed: number;
  sampledPageNumbers?: number[];
  truncatedByPageLimit: boolean;
  duplicateContentSkipped?: boolean;
  pages: PdfPageExtraction[];
}

function normalizePdfTitle(value: string): string | undefined {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (normalized.length < 8 || normalized.length > 300) return undefined;
  if (!/[\p{L}]{3}/u.test(normalized)) return undefined;
  if (/^(?:xxx|unknown|untitled|powerpoint presentation|microsoft word|document\d*|scan\d*)$/iu.test(normalized)) {
    return undefined;
  }
  if (/^(?:_x[0-9a-f]{4}_)+$/iu.test(normalized)) return undefined;
  return normalized;
}

function safePdfTitle(info: unknown): string | undefined {
  if (!info || typeof info !== "object") return undefined;
  const title = (info as { Title?: unknown }).Title;
  return typeof title === "string" ? normalizePdfTitle(title) : undefined;
}

export interface PdfExtractionOptions {
  /** Hard upper bound on the number of pages sent through the text parser. */
  maxPages?: number;
  /** Checked before the PDF is read into memory. Defaults to 50 MiB. */
  maxBytes?: number;
  /** Called after hashing/signature validation and before page parsing. */
  shouldSkipContentHash?: (contentHash: string) => boolean;
  /** Extract only the first, middle, and last page, with a traversal ceiling. */
  samplePagePositions?: boolean;
}

const MAX_POSITION_SAMPLE_PAGES = 500;

const DEFAULT_MAX_PAGES = 500;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Extract each page once with pdf-parse/pdf.js and attach a text-quality
 * assessment. This function does not OCR, chunk, embed, or persist content.
 */
export async function extractPdfPages(
  filePath: string,
  options: PdfExtractionOptions = {}
): Promise<PdfExtractionReport> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error("maxPages must be a positive integer");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer");
  }

  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("PDF input must be a regular file");
  if (stat.size > maxBytes) {
    throw new Error(`PDF is ${stat.size} bytes; limit is ${maxBytes} bytes`);
  }

  const buffer = await fs.readFile(filePath);
  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Input does not have a PDF file signature");
  }
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  if (options.shouldSkipContentHash?.(contentHash)) {
    return {
      sourceFile: path.basename(filePath),
      contentHash,
      sizeBytes: stat.size,
      totalPages: 0,
      pagesProcessed: 0,
      truncatedByPageLimit: false,
      duplicateContentSkipped: true,
      pages: [],
    };
  }

  let selectedPages: Set<number> | null = null;
  let totalPagesHint: number | undefined;
  if (options.samplePagePositions) {
    const countPass = await pdfParse(buffer, { max: 1, pagerender: async () => "" });
    totalPagesHint = countPass.numpages;
    if (totalPagesHint < 1) throw new Error("PDF reports no pages");
    if (totalPagesHint > MAX_POSITION_SAMPLE_PAGES) {
      throw new Error(
        `PDF has ${totalPagesHint} pages; positional sampling is capped at ${MAX_POSITION_SAMPLE_PAGES} pages to bound traversal`
      );
    }
    selectedPages = new Set([
      1,
      Math.ceil(totalPagesHint / 2),
      totalPagesHint,
    ]);
  }

  const extracted = new Map<number, string>();
  let callbackPageNumber = 0;
  const parsed = await pdfParse(buffer, {
    max: selectedPages ? totalPagesHint : maxPages,
    pagerender: async (pageData: {
      getTextContent: () => Promise<{
        items: Array<{
          str?: string;
          transform?: number[];
        }>;
      }>;
    }) => {
      callbackPageNumber += 1;
      const pageNumber = callbackPageNumber;
      if (selectedPages && !selectedPages.has(pageNumber)) return "";
      try {
        const content = await pageData.getTextContent();
        const lines: string[] = [];
        let previousY: number | undefined;

        for (const item of content.items) {
          if (typeof item.str !== "string" || item.str.length === 0) continue;
          const y = item.transform?.[5];
          if (lines.length > 0) {
            lines.push(y !== undefined && y !== previousY ? "\n" : " ");
          }
          lines.push(item.str);
          previousY = y;
        }

        const text = lines.join("").trim();
        extracted.set(pageNumber, text);
        return text;
      } catch {
        // Preserve the page slot as empty so that a later OCR route can see it.
        extracted.set(pageNumber, "");
        return "";
      }
    },
  });

  const pageLimit = selectedPages ? parsed.numpages : Math.min(parsed.numpages, maxPages);
  const pages: PdfPageExtraction[] = [];
  for (let pageNumber = 1; pageNumber <= parsed.numpages; pageNumber += 1) {
    if (pageNumber > pageLimit) {
      pages.push({
        pageNumber,
        text: "",
        extractionStatus: "not_processed",
        quality: null,
      });
      continue;
    }

    if (selectedPages && !selectedPages.has(pageNumber)) {
      pages.push({
        pageNumber,
        text: "",
        extractionStatus: "not_processed",
        quality: null,
      });
      continue;
    }

    const text = extracted.get(pageNumber) ?? "";
    pages.push({
      pageNumber,
      text,
      extractionStatus: text.trim() ? "text_extracted" : "no_text_layer",
      quality: assessExtractedText(text),
    });
  }

  return {
    sourceFile: path.basename(filePath),
    title: safePdfTitle(parsed.info),
    contentHash,
    sizeBytes: stat.size,
    totalPages: parsed.numpages,
    pagesProcessed: selectedPages ? selectedPages.size : pageLimit,
    ...(selectedPages ? { sampledPageNumbers: [...selectedPages].sort((a, b) => a - b) } : {}),
    truncatedByPageLimit: selectedPages ? false : parsed.numpages > maxPages,
    pages,
  };
}
