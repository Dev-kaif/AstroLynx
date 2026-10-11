import { createHash } from "node:crypto";
import { Document } from "@langchain/core/documents";
import { AgentState } from "./Memory";
import { BaseMessage } from "@langchain/core/messages";
import { pineconeVectorStore } from "./initializeChatService";
import { env } from "../config/env";
import { assessExtractedText } from "../ingestion/textQuality";
import { loadMosdacBm25Index } from "../ingestion/lexicalIndex";
import { EmbeddingDimensionMismatchError, QUERY_EMBEDDING_MODEL } from "./cachedEmbeddings";
import { logStageTiming, startTimer } from "../utils/performanceLog";

const RRF_K = 60;
// Over-fetch so the extraction-quality/provenance gate can discard noisy
// legacy matches without starving the grounded context of readable passages.
const DENSE_VECTOR_CANDIDATE_LIMIT = 40;
const LEXICAL_CANDIDATE_LIMIT = 20;
const VECTOR_RETURN_LIMIT = 8;
const MAX_PARALLEL_QUERY_VARIANTS = 3;
const DENSE_RESULT_CACHE_TTL_MS = 30_000;
const DENSE_RESULT_CACHE_MAX_ENTRIES = 64;
const DENSE_RESULT_CACHE_MAX_CHARACTERS = 100_000;

interface RetrievalOutcome {
  documents: Document[];
  enabled: boolean;
  error?: unknown;
}

interface CachedDenseResults {
  documents: Document[];
  scores: number[];
  expiresAt: number;
}

const denseResultCache = new Map<string, CachedDenseResults>();
const inFlightDenseQueries = new Map<string, Promise<CachedDenseResults>>();

function denseScoreMetrics(scores: number[]): Record<string, number> {
  const finiteScores = scores.filter(Number.isFinite);
  if (finiteScores.length === 0) return {};
  return {
    scoredCandidates: finiteScores.length,
    minScore: Number(Math.min(...finiteScores).toFixed(6)),
    maxScore: Number(Math.max(...finiteScores).toFixed(6)),
    meanScore: Number((finiteScores.reduce((sum, score) => sum + score, 0) / finiteScores.length).toFixed(6)),
  };
}

function hasTraceableSource(document: Document): boolean {
  const metadata = document.metadata ?? {};
  const source = metadata.source ?? metadata.file_path ?? metadata.filepath ?? metadata.url;
  if (typeof source !== "string" || source.trim().length === 0) return false;
  return !/^(?:pinecone_vector|unknown(?: source)?|none|null)$/iu.test(source.trim());
}

function documentIdentity(document: Document): string {
  const metadata = document.metadata ?? {};
  const chunkId =
    metadata.chunkId ??
    metadata.chunk_id;
  const contentHash = createHash("sha256")
    .update(document.pageContent)
    .digest("hex");
  const source = metadata.source ?? metadata.file_path ?? metadata.filepath ?? metadata.url;
  const page = metadata.pageNumber ?? metadata.page_number ?? metadata.page;
  // Dense and lexical stores can assign unrelated IDs to the same chunk.
  // Shared provenance plus exact content is the cross-store identity; keep
  // store IDs as a fallback when provenance is incomplete.
  if (
    typeof source === "string" && source.trim().length > 0 &&
    page !== undefined && page !== null && String(page).trim().length > 0
  ) {
    return `${source.trim()}#${String(page).trim()}:${contentHash}`;
  }
  const stableId = chunkId ?? metadata.id ?? document.id ?? null;
  return stableId ? `${String(stableId)}:${contentHash}` : contentHash;
}

/** Reciprocal-rank fusion with stable, content-aware chunk de-duplication. */
export function reciprocalRankFusion(
  rankedLists: Document[][],
  k = RRF_K
): Document[] {
  const scores = new Map<string, number>();
  const documents = new Map<string, Document>();

  for (const list of rankedLists) {
    const listSeen = new Set<string>();
    list.forEach((document, index) => {
      const id = documentIdentity(document);
      if (listSeen.has(id)) return;
      listSeen.add(id);
      documents.set(id, documents.get(id) ?? document);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([id]) => documents.get(id)!)
    .filter(Boolean);
}

/** One bounded dense retrieval call; callers decide whether to fan out. */
export async function retrieveFromVectorDB(query: string): Promise<RetrievalOutcome> {
  if (!pineconeVectorStore) {
    return {
      documents: [],
      enabled: true,
      error: new Error("Pinecone vector store is unavailable"),
    };
  }

  const startedAt = startTimer();
  const cacheKey = createHash("sha256")
    .update(env.PINECONE_INDEX_NAME ?? "")
    .update("\0")
    .update(QUERY_EMBEDDING_MODEL)
    .update("\0")
    .update(query)
    .digest("hex");
  const now = Date.now();
  const cached = denseResultCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    denseResultCache.delete(cacheKey);
    denseResultCache.set(cacheKey, cached);
    logStageTiming("dense_search", startedAt, {
      outcome: "cache_hit",
      candidates: cached.documents.length,
      cacheEntries: denseResultCache.size,
      ...denseScoreMetrics(cached.scores),
    });
    return { documents: cached.documents, enabled: true };
  }
  if (cached) denseResultCache.delete(cacheKey);

  const inFlight = inFlightDenseQueries.get(cacheKey);
  if (inFlight) {
    try {
      const results = await inFlight;
      logStageTiming("dense_search", startedAt, {
        outcome: "coalesced",
        candidates: results.documents.length,
        ...denseScoreMetrics(results.scores),
      });
      return { documents: results.documents, enabled: true };
    } catch (error) {
      logStageTiming("dense_search", startedAt, {
        outcome: "coalesced_error",
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return { documents: [], enabled: true, error };
    }
  }

  const request = (async () => {
    const candidates = await pineconeVectorStore!.similaritySearchWithScore(
      query,
      DENSE_VECTOR_CANDIDATE_LIMIT
    );
    const traceable = candidates.filter(([document]) => hasTraceableSource(document));
    const readable = traceable.filter(
      ([document]) => assessExtractedText(document.pageContent).status === "usable"
    );
    if (readable.length < candidates.length) {
      console.info(
        `Dense retrieval quality gate retained ${readable.length}/${candidates.length} candidates with readable text and source provenance.`
      );
    }
    const selected = readable.slice(0, VECTOR_RETURN_LIMIT);
    const documents = selected.map(([document]) => document);
    const scores = selected.map(([, score]) => score).filter(Number.isFinite);
    const contentCharacters = documents.reduce(
      (total, document) => total + document.pageContent.length,
      0
    );
    // A short TTL limits stale results; per-entry and entry-count caps bound
    // process memory even if a legacy chunk is unexpectedly large.
    if (contentCharacters <= DENSE_RESULT_CACHE_MAX_CHARACTERS) {
      denseResultCache.set(cacheKey, {
        documents,
        scores,
        expiresAt: Date.now() + DENSE_RESULT_CACHE_TTL_MS,
      });
      while (denseResultCache.size > DENSE_RESULT_CACHE_MAX_ENTRIES) {
        const oldestKey = denseResultCache.keys().next().value;
        if (oldestKey === undefined) break;
        denseResultCache.delete(oldestKey);
      }
    }
    return { documents, scores, expiresAt: Date.now() + DENSE_RESULT_CACHE_TTL_MS };
  })();
  inFlightDenseQueries.set(cacheKey, request);
  try {
    const results = await request;
    logStageTiming("dense_search", startedAt, {
      outcome: "completed",
      candidates: results.documents.length,
      cacheEntries: denseResultCache.size,
      ...denseScoreMetrics(results.scores),
    });
    return { documents: results.documents, enabled: true };
  } catch (error) {
    logStageTiming("dense_search", startedAt, {
      outcome: "error",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { documents: [], enabled: true, error };
  } finally {
    if (inFlightDenseQueries.get(cacheKey) === request) {
      inFlightDenseQueries.delete(cacheKey);
    }
  }
}

/** Optional local BM25 path; it stays disabled until an explicit sidecar is configured. */
export async function retrieveFromLexicalIndex(query: string): Promise<RetrievalOutcome> {
  if (!env.MOSDAC_LEXICAL_INDEX_PATH) return { documents: [], enabled: false };
  try {
    const index = await loadMosdacBm25Index(env.MOSDAC_LEXICAL_INDEX_PATH);
    if (!index) return { documents: [], enabled: true };
    const documents = index.search(query, LEXICAL_CANDIDATE_LIMIT)
      .filter(hasTraceableSource)
      .filter((document) => assessExtractedText(document.pageContent).status === "usable")
      .slice(0, VECTOR_RETURN_LIMIT);
    return { documents, enabled: true };
  } catch (error) {
    return { documents: [], enabled: true, error };
  }
}

function messageText(message: BaseMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
        ? [part.text]
        : []
    )
    .join(" ")
    .trim();
}

function isClearFollowUp(question: string): boolean {
  const normalized = question.trim();
  return [
    /^(?:and\b|also\b|what about\b|how about\b|what is (?:its|their|that|this)\b|what are (?:its|their|those|these)\b|what was (?:its|their|that)\b|how (?:does|do|did) (?:it|they|that|this)\b|why (?:is|was|does|did) (?:it|that|this)\b|can you (?:explain|elaborate) (?:that|it)\b|tell me more\b)/iu,
    /^(?:aur\b|(?:is|us)ke (?:baare|bare) mein\b|is(?:ka|ki|ke)\b|yeh?\b|woh\b|us(?:ka|ki|ke)\b|aur bata(?:o|iye)\b|kya (?:yeh?|woh|is(?:ka|ki|ke)|us(?:ka|ki|ke))\b)/iu,
    /^(?:और\b|इसके बारे में\b|इस(?:का|की|के|में)\b|यह\b|ये\b|वह\b|उस(?:का|की|के|में)\b|और बत(?:ाओ|ाइए|ा दें)\b|क्या (?:यह|ये|वह|इसका|इसकी|इसके|उसका|उसकी|उसके)\b)/u,
    /^(?:y\b|también\b|tambien\b|qué hay de\b|que hay de\b|y qué\b|y que\b|su\b|eso\b|eso qué\b)/iu,
    /^(?:et\b|aussi\b|qu['’]en est-il\b|son\b|sa\b|ça\b|cela\b|ce\b)/iu,
    /^(?:und\b|auch\b|was ist mit\b|sein\b|ihre?\b|dies(?:e|er|es)?\b|das\b)/iu,
  ].some((pattern) => pattern.test(normalized));
}

function lastHumanQuestion(history: BaseMessage[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.getType() !== "human") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return undefined;
}

/** Add a previous-question anchor only for recognizable short follow-ups. */
export function queryTransformation(
  state: AgentState
): Partial<AgentState> {
  const question = state.question.trim();
  const priorQuestion = lastHumanQuestion(state.chat_history ?? []);
  const isContextualFollowUp = Boolean(
    priorQuestion &&
      isClearFollowUp(question)
  );
  const retrievalQuery = isContextualFollowUp
    ? `Earlier user question: ${priorQuestion!.slice(0, 400)}\nCurrent follow-up: ${question}`
    : question;

  return { rewritten_queries: [retrievalQuery], hypothetical_doc_query: null };
}

/** Run a bounded number of independent query variants concurrently. */
export async function parallelRetrieval(
  state: AgentState
): Promise<Partial<AgentState>> {
  const variants = [...new Set(state.rewritten_queries ?? [state.question])]
    .filter((query) => query.trim().length > 0)
    .slice(0, MAX_PARALLEL_QUERY_VARIANTS);
  if (variants.length === 0) {
    return { raw_pinecone_results: [], raw_lexical_results: [] };
  }

  const startedAt = startTimer();
  try {
    const rankedResults = await Promise.all(variants.map((query) => Promise.all([
      retrieveFromVectorDB(query),
      retrieveFromLexicalIndex(query),
    ])));
    const denseOutcomes = rankedResults.map(([dense]) => dense);
    const lexicalOutcomes = rankedResults.map(([, lexical]) => lexical);
    const enabledOutcomes = [...denseOutcomes, ...lexicalOutcomes].filter((outcome) => outcome.enabled);
    const failedOutcomes = enabledOutcomes.filter((outcome) => outcome.error !== undefined);
    const dimensionError = failedOutcomes.find(
      (outcome) => outcome.error instanceof EmbeddingDimensionMismatchError
    )?.error;
    if (dimensionError instanceof Error) throw dimensionError;
    if (enabledOutcomes.length > 0 && failedOutcomes.length === enabledOutcomes.length) {
      throw new Error("All configured retrieval sources failed");
    }
    for (const outcome of failedOutcomes) {
      console.warn("Retrieval source failed:", outcome.error instanceof Error ? outcome.error.name : "unknown");
    }
    const denseResults = denseOutcomes.map((outcome) => outcome.documents);
    const lexicalResults = lexicalOutcomes.map((outcome) => outcome.documents);
    logStageTiming("retrieval", startedAt, {
      queryVariants: variants.length,
      denseCandidates: denseResults.reduce((total, documents) => total + documents.length, 0),
      lexicalCandidates: lexicalResults.reduce((total, documents) => total + documents.length, 0),
      lexicalEnabled: Boolean(env.MOSDAC_LEXICAL_INDEX_PATH),
      failedSources: failedOutcomes.length,
      outcome: failedOutcomes.length > 0 ? "degraded" : "completed",
    });
    return {
      raw_pinecone_results: denseResults,
      raw_lexical_results: lexicalResults,
    };
  } catch (error) {
    logStageTiming("retrieval", startedAt, {
      queryVariants: variants.length,
      outcome: "error",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}

export function rrfReRanking(state: AgentState): Partial<AgentState> {
  const lists = [
    ...(state.raw_pinecone_results ?? []),
    ...(state.raw_lexical_results ?? []),
  ];
  return { rrf_ranked_docs: reciprocalRankFusion(lists) };
}

/** Greeting detection is deterministic and avoids a model call before retrieval. */
export function classifyQuery(state: AgentState): Partial<AgentState> {
  const normalized = state.question.trim().toLocaleLowerCase();
  const greeting =
    /^(?:hi|hello|hey|good morning|good afternoon|good evening|how are you|hola|buenos días|buenos dias|buenas tardes|buenas noches|qué tal|que tal|bonjour|bonsoir|salut|comment ça va|comment ca va|hallo|guten morgen|guten tag|guten abend|wie geht(?:'|’)s|wie geht es|namaste|नमस्ते|नमस्कार)(?:\s+(?:astrolynx|there))?[.!?\s؟。！]*$/iu.test(
      normalized
    );
  return { llm_response: greeting ? "greeting" : "mosdac" };
}
