import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import {  OllamaEmbeddings } from "@langchain/ollama";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";
dotenv.config();

// Use consistent resolved PDF folder
// const pdfFolder = path.resolve(__dirname, "../mosac-data");
const pdfFolder = path.resolve(__dirname, "../mosac-data");

async function pipeline(pdfDir: string) {
  console.log(`📂 PDF folder: ${pdfDir}`);
  const allFiles = await fs.readdir(pdfDir);
  console.log("All files:", allFiles);

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


  const embeddings = new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: "http://localhost:11434",
  });


  const pineClient = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });

  const pineStore = new PineconeStore(embeddings, {
    pineconeIndex: pineClient.Index(process.env.PINECONE_INDEX_NAME!),
  });

  for (const pdfPath of pdfFiles) {
    console.log(`\n➡️ Processing: ${pdfPath}`);
    const docs = await new PDFLoader(pdfPath).load();
    console.log(`  📄 Loaded ${docs.length} page(s) from PDF`);

    const chunks = await splitter.splitDocuments(docs);
    console.log(`  ✂️ Split into ${chunks.length} chunks`)

    // await pineStore.addDocuments(chunks);

    // const batchSize = 100; 
    
    // for (let i = 0; i < chunks.length; i += batchSize) {
    //     const batch = chunks.slice(i, i + batchSize);
    //     console.log(`Embedding batch ${i} - ${i + batch.length}`);
    //     try {
    //       await pineStore.addDocuments(batch);
    //       console.log(`✅ Batch ${i} - ${i + batch.length} embedded.`);
    //     } catch (e) {
    //       console.error(`❌ Error embedding batch ${i} - ${i + batch.length}:`, e);
    //     }
    //   }

    console.log("  🧠 Chunks embedded into Pinecone");
  }

  console.log("\n🎉 Pipeline finished.");
}

pipeline(pdfFolder).catch((e) => {
  console.error( "❌ Pipeline error:", e);
  process.exit(1);
});
