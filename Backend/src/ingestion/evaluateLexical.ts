import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadMosdacBm25Index } from "./lexicalIndex";

interface RelevantPassage {
  sourceId: string;
  pageNumber?: number;
}

interface EvaluationQuestion {
  id: string;
  query: string;
  relevant: RelevantPassage[];
}

function parseArguments(args: string[]) {
  const value = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const result = args[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`${flag} requires a value`);
    return result;
  };
  const indexPath = value("--index");
  const datasetPath = value("--dataset");
  if (!indexPath || !datasetPath) {
    throw new Error("Usage: pnpm rag:evaluate-lexical -- --index <sidecar.json> --dataset <labels.json> [--k 5]");
  }
  const rawK = value("--k");
  const k = rawK === undefined ? 5 : Number(rawK);
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error("--k must be an integer from 1 to 100");
  const rawRepeats = value("--repeats");
  const repeats = rawRepeats === undefined ? 10 : Number(rawRepeats);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 100) {
    throw new Error("--repeats must be an integer from 1 to 100");
  }
  return { indexPath: path.resolve(indexPath), datasetPath: path.resolve(datasetPath), k, repeats };
}

function validateDataset(value: unknown): EvaluationQuestion[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
    throw new Error("Dataset must be a non-empty JSON array containing at most 1000 questions");
  }
  const ids = new Set<string>();
  return value.map((row, rowIndex) => {
    if (!row || typeof row !== "object") throw new Error(`Question ${rowIndex + 1} must be an object`);
    const candidate = row as Partial<EvaluationQuestion>;
    if (typeof candidate.id !== "string" || !candidate.id.trim() || candidate.id.length > 100) {
      throw new Error(`Question ${rowIndex + 1} must have a non-empty id of at most 100 characters`);
    }
    if (ids.has(candidate.id)) throw new Error(`Duplicate question id: ${candidate.id}`);
    ids.add(candidate.id);
    if (typeof candidate.query !== "string" || !candidate.query.trim() || candidate.query.length > 2000) {
      throw new Error(`Question ${candidate.id} must have a non-empty query of at most 2000 characters`);
    }
    if (!Array.isArray(candidate.relevant) || candidate.relevant.length === 0 || candidate.relevant.length > 100) {
      throw new Error(`Question ${candidate.id} needs 1 to 100 relevant source/page labels`);
    }
    const relevantKeys = new Set<string>();
    const relevant = candidate.relevant.map((item, index) => {
      if (!item || typeof item !== "object" || typeof item.sourceId !== "string" || !/^[a-f0-9]{64}$/u.test(item.sourceId)) {
        throw new Error(`Question ${candidate.id} relevance label ${index + 1} needs a 64-character sourceId`);
      }
      if (item.pageNumber !== undefined && (!Number.isInteger(item.pageNumber) || item.pageNumber < 1)) {
        throw new Error(`Question ${candidate.id} relevance label ${index + 1} has an invalid pageNumber`);
      }
      const key = resultKey(item.sourceId, item.pageNumber);
      if (!key || relevantKeys.has(key)) throw new Error(`Question ${candidate.id} has a duplicate relevance label`);
      relevantKeys.add(key);
      return { sourceId: item.sourceId, pageNumber: item.pageNumber };
    });
    return { id: candidate.id, query: candidate.query, relevant };
  });
}

function resultKey(sourceId: unknown, pageNumber: unknown): string | undefined {
  if (typeof sourceId !== "string") return undefined;
  return `${sourceId}\0${Number.isInteger(pageNumber) ? String(pageNumber) : "*"}`;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)]!;
}

async function main(): Promise<void> {
  const { indexPath, datasetPath, k, repeats } = parseArguments(process.argv.slice(2));
  const dataset = validateDataset(JSON.parse(await fs.readFile(datasetPath, "utf8")) as unknown);
  const index = await loadMosdacBm25Index(indexPath);
  if (!index) throw new Error("Could not load the specified lexical index");

  const latenciesMs: number[] = [];
  let hitAtK = 0;
  let reciprocalRankTotal = 0;
  let recallTotal = 0;
  let ndcgTotal = 0;
  const perQuestion = dataset.map((question) => {
    const relevantKeys = new Set(question.relevant.map((item) => resultKey(item.sourceId, item.pageNumber)!));
    let results = index.search(question.query, k); // Unmeasured per-query warm-up.
    const questionLatenciesMs: number[] = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const startedAt = performance.now();
      results = index.search(question.query, k);
      const latencyMs = performance.now() - startedAt;
      questionLatenciesMs.push(latencyMs);
      latenciesMs.push(latencyMs);
    }

    const rankedKeys: string[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      const key = resultKey(result.metadata.sourceId, result.metadata.page);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rankedKeys.push(key);
    }
    const matchedLabel = (key: string): string | undefined => {
      if (relevantKeys.has(key)) return key;
      const sourceLevelLabel = `${key.slice(0, key.indexOf("\0"))}\0*`;
      return relevantKeys.has(sourceLevelLabel) ? sourceLevelLabel : undefined;
    };
    const firstRelevantRank = rankedKeys.findIndex((key) => matchedLabel(key) !== undefined);
    const matchedLabels = new Set<string>();
    const relevantRanks = new Set<number>();
    rankedKeys.forEach((key, rank) => {
      const label = matchedLabel(key);
      if (label && !matchedLabels.has(label)) {
        matchedLabels.add(label);
        relevantRanks.add(rank);
      }
    });
    const relevantHits = matchedLabels.size;
    const recallAtK = relevantHits / relevantKeys.size;
    const dcg = [...relevantRanks].reduce((sum, rank) => sum + 1 / Math.log2(rank + 2), 0);
    const idealDcg = Array.from({ length: Math.min(relevantKeys.size, k) }, (_, rank) => 1 / Math.log2(rank + 2))
      .reduce((sum, gain) => sum + gain, 0);
    const reciprocalRank = firstRelevantRank < 0 ? 0 : 1 / (firstRelevantRank + 1);
    const ndcgAtK = idealDcg ? dcg / idealDcg : 0;
    if (firstRelevantRank >= 0) hitAtK += 1;
    reciprocalRankTotal += reciprocalRank;
    recallTotal += recallAtK;
    ndcgTotal += ndcgAtK;
    return {
      id: question.id,
      retrieved: results.length,
      relevantLabels: relevantKeys.size,
      recallAtK,
      reciprocalRank,
      ndcgAtK,
      latencyMs: {
        p50: Number(percentile(questionLatenciesMs, 0.5).toFixed(3)),
        p95: Number(percentile(questionLatenciesMs, 0.95).toFixed(3)),
      },
      topResults: results.slice(0, Math.min(k, 5)).map((result) => ({
        title: result.metadata.title,
        sourceId: result.metadata.sourceId,
        source: result.metadata.source,
        pageNumber: result.metadata.page,
        chunkId: result.metadata.chunkId,
      })),
    };
  });

  process.stdout.write(`${JSON.stringify({
    mode: "offline-bm25-retrieval-evaluation",
    indexPath,
    corpusVersion: index.corpusVersion,
    datasetPath,
    questions: dataset.length,
    k,
    repeatsPerQuestion: repeats,
    warmup: "one unmeasured sidecar search per question",
    metrics: {
      hitRateAtK: hitAtK / dataset.length,
      recallAtK: recallTotal / dataset.length,
      meanReciprocalRank: reciprocalRankTotal / dataset.length,
      ndcgAtK: ndcgTotal / dataset.length,
      latencyMs: {
        p50: Number(percentile(latenciesMs, 0.5).toFixed(3)),
        p95: Number(percentile(latenciesMs, 0.95).toFixed(3)),
      },
    },
    perQuestion,
    limitations: [
      "Scores retrieval only; answer correctness, citation support, abstention, and end-to-end latency are not measured.",
      "Relevance labels should be assigned by reviewing source pages; ingestion quality heuristics are not relevance judgments.",
      "Latency is local sidecar search time and excludes process startup, query embedding, network, reranking, and generation.",
    ],
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
