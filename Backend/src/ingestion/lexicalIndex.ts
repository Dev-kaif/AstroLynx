import fs from "node:fs/promises";
import { Document } from "@langchain/core/documents";

interface LexicalChunk {
  id: string;
  sourceId: string;
  sourceFile: string;
  title?: string;
  pageNumber: number;
  chunkNumber: number;
  text: string;
}

interface LexicalIndexFile {
  version: 1;
  corpusVersion: string;
  chunks: LexicalChunk[];
}

// Keep combining marks inside a token. Indic scripts (including Devanagari)
// use marks for vowel signs and other orthographic parts of a word; dropping
// them fragments Hindi words and makes exact lexical matching unreliable.
const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[-._/][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
const K1 = 1.2;
const B = 0.75;

export const LEXICAL_INDEX_LIMITS = {
  maxBytes: 128 * 1024 * 1024,
  maxChunks: 50_000,
  maxTokens: 20_000_000,
  maxPostings: 5_000_000,
  maxChunkCharacters: 20_000,
} as const;

export function tokenizeLexicalText(input: string): string[] {
  return input.normalize("NFKC").toLowerCase().match(TOKEN_PATTERN) ?? [];
}

function isLexicalIndexFile(value: unknown): value is LexicalIndexFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LexicalIndexFile>;
  return candidate.version === 1 &&
    typeof candidate.corpusVersion === "string" &&
    /^[a-f0-9]{64}$/u.test(candidate.corpusVersion) &&
    Array.isArray(candidate.chunks) &&
    candidate.chunks.length <= LEXICAL_INDEX_LIMITS.maxChunks &&
    candidate.chunks.every((chunk) =>
      Boolean(chunk) &&
      typeof chunk.id === "string" && /^[a-f0-9]{64}$/u.test(chunk.id) &&
      typeof chunk.sourceId === "string" && /^[a-f0-9]{64}$/u.test(chunk.sourceId) &&
      typeof chunk.sourceFile === "string" && chunk.sourceFile.length > 0 &&
      (chunk.title === undefined || (typeof chunk.title === "string" && chunk.title.trim().length > 0 && chunk.title.length <= 300)) &&
      Number.isInteger(chunk.pageNumber) && chunk.pageNumber >= 1 &&
      Number.isInteger(chunk.chunkNumber) && chunk.chunkNumber >= 0 &&
      typeof chunk.text === "string" &&
      chunk.text.length > 0 &&
      chunk.text.length <= LEXICAL_INDEX_LIMITS.maxChunkCharacters
    );
}

export class MosdacBm25Index {
  readonly corpusVersion: string;
  private readonly chunks: LexicalChunk[];
  private readonly postings = new Map<string, Uint32Array>();
  private readonly documentLengths: Uint32Array;
  private readonly averageLength: number;

  constructor(index: LexicalIndexFile) {
    this.corpusVersion = index.corpusVersion;
    this.chunks = index.chunks;
    this.documentLengths = new Uint32Array(this.chunks.length);
    const documentFrequency = new Map<string, number>();
    let totalTokens = 0;
    let totalPostings = 0;

    this.chunks.forEach((chunk, documentIndex) => {
      const terms = new Map<string, number>();
      for (const token of tokenizeLexicalText(chunk.text)) {
        terms.set(token, (terms.get(token) ?? 0) + 1);
      }
      for (const term of terms.keys()) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
      const length = [...terms.values()].reduce((sum, count) => sum + count, 0);
      totalTokens += length;
      totalPostings += terms.size;
      if (totalTokens > LEXICAL_INDEX_LIMITS.maxTokens || totalPostings > LEXICAL_INDEX_LIMITS.maxPostings) {
        throw new Error("Lexical index exceeds the configured token/posting build limits");
      }
      this.documentLengths[documentIndex] = length;
    });
    this.averageLength = this.chunks.length
      ? totalTokens / this.chunks.length
      : 0;

    for (const [term, frequency] of documentFrequency) {
      this.postings.set(term, new Uint32Array(frequency * 2));
    }
    const offsets = new Map<string, number>();
    this.chunks.forEach((chunk, documentIndex) => {
      const termFrequency = new Map<string, number>();
      for (const token of tokenizeLexicalText(chunk.text)) {
        termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
      }
      for (const [term, frequency] of termFrequency) {
        const postingList = this.postings.get(term)!;
        const offset = offsets.get(term) ?? 0;
        postingList[offset] = documentIndex;
        postingList[offset + 1] = frequency;
        offsets.set(term, offset + 2);
      }
    });
  }

  search(query: string, limit = 20): Document[] {
    if (!Number.isInteger(limit) || limit <= 0) return [];
    limit = Math.min(limit, 100);
    const queryTerms = [...new Set(tokenizeLexicalText(query))];
    if (!queryTerms.length || !this.chunks.length || this.averageLength <= 0) return [];
    const scores = new Map<number, number>();
    for (const term of queryTerms) {
      const postingList = this.postings.get(term);
      if (!postingList) continue;
      const documentFrequency = postingList.length / 2;
      const idf = Math.log(1 + (this.chunks.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
      for (let offset = 0; offset < postingList.length; offset += 2) {
        const documentIndex = postingList[offset]!;
        const frequency = postingList[offset + 1]!;
        const length = this.documentLengths[documentIndex]!;
        const denominator = frequency + K1 * (1 - B + B * length / this.averageLength);
        const score = idf * (frequency * (K1 + 1)) / denominator;
        scores.set(documentIndex, (scores.get(documentIndex) ?? 0) + score);
      }
    }
    const scored = [...scores.entries()].map(([documentIndex, score]) => ({
      chunk: this.chunks[documentIndex]!,
      score,
    }));
    scored.sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
    return scored.slice(0, limit).map(({ chunk, score }) => new Document({
      pageContent: chunk.text,
      metadata: {
        id: chunk.id,
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        source: chunk.sourceFile,
        title: chunk.title ?? chunk.sourceFile,
        file_path: chunk.sourceFile,
        page: chunk.pageNumber,
        chunkNumber: chunk.chunkNumber,
        retrievalMethod: "bm25",
        bm25Score: score,
        corpusVersion: this.corpusVersion,
      },
    }));
  }
}

let loadedIndex: MosdacBm25Index | null = null;
let loadedPath: string | null = null;
let inFlightLoad: {
  path: string;
  promise: Promise<MosdacBm25Index>;
} | null = null;

/** Load at most one bounded lexical sidecar per process; unset path means dense-only mode. */
export async function loadMosdacBm25Index(indexPath?: string): Promise<MosdacBm25Index | null> {
  if (!indexPath) return null;
  if (loadedIndex && loadedPath === indexPath) return loadedIndex;

  if (inFlightLoad) {
    if (inFlightLoad.path === indexPath) return inFlightLoad.promise;
    await inFlightLoad.promise.catch(() => undefined);
    return loadMosdacBm25Index(indexPath);
  }

  // Retain only the requested corpus while a replacement is loading. Calls
  // for a different path wait for this load, preventing concurrent sidecars
  // from racing to populate a single process-wide cache slot.
  loadedIndex = null;
  loadedPath = null;
  const promise = (async () => {
    const stat = await fs.stat(indexPath);
    if (!stat.isFile() || stat.size > LEXICAL_INDEX_LIMITS.maxBytes) {
      throw new Error(`Lexical index must be a regular file no larger than ${LEXICAL_INDEX_LIMITS.maxBytes} bytes`);
    }
    const raw: unknown = JSON.parse(await fs.readFile(indexPath, "utf8"));
    if (!isLexicalIndexFile(raw)) throw new Error("Lexical index file has an invalid schema or exceeds limits");
    return new MosdacBm25Index(raw);
  })();

  const load = { path: indexPath, promise };
  inFlightLoad = load;
  try {
    const index = await promise;
    if (inFlightLoad === load) {
      loadedIndex = index;
      loadedPath = indexPath;
      inFlightLoad = null;
    }
    return index;
  } catch (error) {
    if (inFlightLoad === load) inFlightLoad = null;
    throw error;
  }
}
