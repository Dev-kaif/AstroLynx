import { createHash } from "node:crypto";
import { OllamaEmbeddings } from "@langchain/ollama";
import { logStageTiming, startTimer } from "../utils/performanceLog";

const QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_CACHE_MAX_ENTRIES = 128;
export const QUERY_EMBEDDING_MODEL = "nomic-embed-text";

interface CachedVector {
  vector: number[];
  expiresAt: number;
}

export class EmbeddingDimensionMismatchError extends Error {
  constructor(actual: number, expected: number) {
    super(`Ollama query embedding dimension ${actual} does not match Pinecone index dimension ${expected}`);
    this.name = "EmbeddingDimensionMismatchError";
  }
}

/** Short-lived cache for exact repeated query vectors; document embeddings are unaffected. */
export class CachedOllamaEmbeddings extends OllamaEmbeddings {
  private readonly queryCache = new Map<string, CachedVector>();
  private readonly inFlightQueries = new Map<string, Promise<number[]>>();
  private expectedDimension: number | null = null;

  setExpectedDimension(dimension: number): void {
    if (!Number.isInteger(dimension) || dimension < 1) {
      throw new Error("Expected query embedding dimension must be a positive integer");
    }
    if (this.expectedDimension !== dimension) this.queryCache.clear();
    this.expectedDimension = dimension;
  }

  override async embedQuery(text: string): Promise<number[]> {
    const startedAt = startTimer();
    const key = createHash("sha256")
      .update(this.model)
      .update("\0")
      .update(text)
      .digest("hex");
    const now = Date.now();
    const cached = this.queryCache.get(key);
    if (cached && cached.expiresAt > now) {
      this.queryCache.delete(key);
      this.queryCache.set(key, cached);
      logStageTiming("query_embedding", startedAt, {
        outcome: "cache_hit",
        cacheEntries: this.queryCache.size,
        vectorDimension: cached.vector.length,
      });
      return [...cached.vector];
    }
    if (cached) this.queryCache.delete(key);

    const inFlight = this.inFlightQueries.get(key);
    if (inFlight) {
      try {
        const vector = await inFlight;
        logStageTiming("query_embedding", startedAt, {
          outcome: "coalesced",
          cacheEntries: this.queryCache.size,
          vectorDimension: vector.length,
        });
        return [...vector];
      } catch (error) {
        logStageTiming("query_embedding", startedAt, {
          outcome: "coalesced_error",
          errorType: error instanceof Error ? error.name : "unknown",
        });
        throw error;
      }
    }

    const request = super.embedQuery(text);
    this.inFlightQueries.set(key, request);
    try {
      const vector = await request;
      if (this.expectedDimension !== null && vector.length !== this.expectedDimension) {
        throw new EmbeddingDimensionMismatchError(vector.length, this.expectedDimension);
      }
      if (vector.length > 0 && vector.every(Number.isFinite)) {
        this.queryCache.set(key, {
          vector: [...vector],
          expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
        });
        while (this.queryCache.size > QUERY_CACHE_MAX_ENTRIES) {
          const oldestKey = this.queryCache.keys().next().value;
          if (oldestKey === undefined) break;
          this.queryCache.delete(oldestKey);
        }
      }
      logStageTiming("query_embedding", startedAt, {
        outcome: "computed",
        cacheEntries: this.queryCache.size,
        vectorDimension: vector.length,
      });
      return [...vector];
    } catch (error) {
      logStageTiming("query_embedding", startedAt, {
        outcome: "error",
        errorType: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    } finally {
      if (this.inFlightQueries.get(key) === request) {
        this.inFlightQueries.delete(key);
      }
    }
  }
}
