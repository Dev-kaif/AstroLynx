import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { LEXICAL_INDEX_LIMITS, tokenizeLexicalText } from "./lexicalIndex";

interface ChunkPlan {
  mode: string;
  embedded: boolean;
  indexWritten: boolean;
  qualityPolicyVersion: string;
  documents: Array<{
    sourceId?: string;
    sourceFile?: string;
    acceptedPageNumbers?: number[];
  }>;
  chunks: Array<{
    id: string;
    sourceId: string;
    sourceFile: string;
    title: string;
    pageNumber: number;
    chunkNumber: number;
    text: string;
  }>;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const planPath = parseFlag(args, "--plan");
  const outputPath = parseFlag(args, "--output");
  if (!planPath || !outputPath || planPath.startsWith("--") || outputPath.startsWith("--")) {
    throw new Error("Usage: pnpm ingest:build-lexical -- --plan <chunk-plan.json> --output <new-index.json>");
  }

  const absolutePlanPath = path.resolve(planPath);
  const plan = JSON.parse(await fs.readFile(absolutePlanPath, "utf8")) as ChunkPlan;
  if (
    plan.mode !== "chunk-plan-dry-run" ||
    plan.embedded !== false ||
    plan.indexWritten !== false ||
    plan.qualityPolicyVersion !== "page-text-quality-v2" ||
    !Array.isArray(plan.documents) ||
    !Array.isArray(plan.chunks)
  ) {
    throw new Error("Input must be an unmodified chunk-plan dry-run report with no index writes");
  }
  if (plan.chunks.length === 0 || plan.chunks.length > LEXICAL_INDEX_LIMITS.maxChunks) {
    throw new Error(`Chunk plan must contain between 1 and ${LEXICAL_INDEX_LIMITS.maxChunks} chunks`);
  }

  const chunkIds = new Set<string>();
  const acceptedPages = new Map<string, Set<number>>();
  for (const document of plan.documents) {
    if (
      typeof document.sourceId === "string" && /^[a-f0-9]{64}$/u.test(document.sourceId) &&
      typeof document.sourceFile === "string" &&
      Array.isArray(document.acceptedPageNumbers) &&
      document.acceptedPageNumbers.every((page) => Number.isInteger(page) && page > 0)
    ) {
      acceptedPages.set(
        `${document.sourceId}\0${document.sourceFile}`,
        new Set(document.acceptedPageNumbers)
      );
    }
  }
  let estimatedTokens = 0;
  let estimatedPostings = 0;
  const chunks = plan.chunks.map((chunk) => {
    if (
      !/^[a-f0-9]{64}$/u.test(chunk.id) ||
      !/^[a-f0-9]{64}$/u.test(chunk.sourceId) ||
      typeof chunk.sourceFile !== "string" ||
      typeof chunk.title !== "string" || !chunk.title.trim() || chunk.title.length > 300 ||
      typeof chunk.text !== "string" ||
      !chunk.text.trim() ||
      chunk.text.length > LEXICAL_INDEX_LIMITS.maxChunkCharacters ||
      !Number.isInteger(chunk.pageNumber) ||
      !Number.isInteger(chunk.chunkNumber)
    ) {
      throw new Error("Chunk plan contains an invalid chunk record");
    }
    if (chunkIds.has(chunk.id)) throw new Error(`Duplicate chunk ID: ${chunk.id}`);
    const expectedChunkId = createHash("sha256")
      .update(`${chunk.sourceId}\0${chunk.pageNumber}\0${chunk.chunkNumber}\0${chunk.text}`)
      .digest("hex");
    if (chunk.id !== expectedChunkId) {
      throw new Error(`Chunk ID does not match its source/page/text: ${chunk.id}`);
    }
    if (!acceptedPages.get(`${chunk.sourceId}\0${chunk.sourceFile}`)?.has(chunk.pageNumber)) {
      throw new Error(`Chunk page is not listed as usable for its source: ${chunk.id}`);
    }
    chunkIds.add(chunk.id);
    const tokens = tokenizeLexicalText(chunk.text);
    estimatedTokens += tokens.length;
    estimatedPostings += new Set(tokens).size;
    if (
      estimatedTokens > LEXICAL_INDEX_LIMITS.maxTokens ||
      estimatedPostings > LEXICAL_INDEX_LIMITS.maxPostings
    ) {
      throw new Error("Chunk plan exceeds the lexical token/posting processing limits");
    }
    return chunk;
  });
  const corpusVersion = createHash("sha256")
    .update([...chunkIds].sort().join("\n"))
    .digest("hex");
  const output = {
    version: 1,
    corpusVersion,
    createdAt: new Date().toISOString(),
    sourcePlan: path.basename(absolutePlanPath),
    chunkCount: chunks.length,
    chunks,
  };
  const serialized = `${JSON.stringify(output)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > LEXICAL_INDEX_LIMITS.maxBytes) {
    throw new Error(`Lexical index exceeds the ${LEXICAL_INDEX_LIMITS.maxBytes} byte runtime load limit`);
  }
  const absoluteOutputPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  const handle = await fs.open(absoluteOutputPath, "wx");
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  process.stdout.write(`${JSON.stringify({
    mode: "lexical-index-build",
    embedded: false,
    vectorIndexWritten: false,
    indexPath: absoluteOutputPath,
    corpusVersion,
    chunks: chunks.length,
    sizeBytes: Buffer.byteLength(serialized, "utf8"),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
