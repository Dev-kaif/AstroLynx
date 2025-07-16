import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { LLMGraphTransformer } from "@langchain/community/experimental/graph_transformers/llm";
import { OllamaEmbeddings } from "@langchain/ollama";
import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import {
  GEMINI_API_KEY,
  NEO4J_PASSWORD,
  NEO4J_URI,
  NEO4J_USERNAME,
} from "./utils/Config";
dotenv.config();

const pdfFolder = path.resolve(__dirname, "../mosac-data");

async function pipeline(pdfDir: string) {
  console.log(`📂 PDF folder: ${pdfDir}`);
  const allFiles = await fs.readdir(pdfDir);
  const pdfFiles = allFiles
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(pdfDir, f));
  console.log("🔍 PDF files:", pdfFiles);

  if (!pdfFiles.length) {
    console.warn("⚠️ No PDFs found in folder. Exiting.");
    return;
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chat = new ChatGoogleGenerativeAI({
    apiKey: GEMINI_API_KEY,
    model: "gemini-2.5-flash",
    temperature: 0.7,
  });

  const embeddings = new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: "http://localhost:11434",
  });

  const transformer = new LLMGraphTransformer({
    llm: chat,
    strictMode: true,
  });

  const graph = await Neo4jGraph.initialize({
    url: NEO4J_URI,
    username: NEO4J_USERNAME,
    password: NEO4J_PASSWORD,
  });
  console.log("✅ Connected to Neo4j");

  const BATCH_SIZE = 50;

  for (const pdfPath of pdfFiles) {
    console.log(`\n➡️ Processing: ${pdfPath}`);
    const docs = await new PDFLoader(pdfPath).load();
    console.log(`  📄 Loaded ${docs.length} page(s)`);

    const chunks = await splitter.splitDocuments(docs);
    console.log(`  ✂️ Split into ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      console.log(
        `🚀 Processing batch ${i / BATCH_SIZE + 1}/${Math.ceil(
          chunks.length / BATCH_SIZE
        )}`
      );

      try {
        const graphDocs = await transformer.convertToGraphDocuments(batch);
        console.log(`  🔗 Created ${graphDocs.length} graph docs`);

        for (const doc of graphDocs) {
          for (const node of doc.nodes) {
            const text =
              node.properties?.name ||
              node.properties?.title ||
              node.properties?.content ||
              "";
            const embedding = await embeddings.embedQuery(text);
            node.properties.embedding = embedding;
          }
        }

        await graph.addGraphDocuments(graphDocs, { includeSource: false });
        console.log(`✅ Inserted batch into Neo4j (${graphDocs.length} docs)`);
      } catch (err) {
        console.error(`❌ Error in batch ${i / BATCH_SIZE + 1}:`, err);
      }

      // Optional: Rate limiting sleep between batches
      await new Promise((res) => setTimeout(res, 2000)); // 2 seconds between batches
    }
  }

  await graph.close();
  console.log("🎉 Pipeline completed.");
}

pipeline(pdfFolder).catch((err) => {
  console.error("❌ Pipeline error:", err);
  process.exit(1);
});
