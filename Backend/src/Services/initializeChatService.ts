import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import { Collection, MongoClient } from "mongodb";
import {
  GEMINI_API_KEY,
  LLM_MODEL_NAME,
  MONGO_COLLECTION_NAME,
  MONGO_DB_NAME,
  MONGO_URI,
  PINECONE_API_KEY,
  PINECONE_ENVIRONMENT,
  PINECONE_INDEX_NAME,
} from "../utils/Config";

import { NEO4J_PASSWORD, NEO4J_URI, NEO4J_USERNAME } from "../utils/Config";
import { Driver } from "neo4j-driver";
import neo4j from "neo4j-driver";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";

// Import the compileGraph function
import { compileGraph } from "./LangGraphChain";

// --- Database & LLM Initializations ---
export let pineconeClient: Pinecone | null = null;
export let pineconeVectorStore: PineconeStore | null = null;
export let chatLLM: ChatGoogleGenerativeAI | null = null;
export let embeddings: OllamaEmbeddings | null = null;

export let mongoClient: MongoClient | null = null;
export let chatSessionsCollection: Collection | null = null;
export let langGraphCheckpointsCollection: Collection | null = null;
export let checkpointer: MongoDBSaver | null = null;

export let neo4jDriver: Driver | null = null;

export async function initializeChatService(): Promise<void> {
  console.log("Initializing Chat Service...");

  // Initialize MongoDB first, as it's needed for checkpointer and chat history
  if (!MONGO_URI || !MONGO_DB_NAME || !MONGO_COLLECTION_NAME) {
    console.error("Error: MongoDB connection details not fully set.");
    throw new Error("MongoDB credentials are missing.");
  }
  try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    const db = mongoClient.db(MONGO_DB_NAME);
    chatSessionsCollection = db.collection(MONGO_COLLECTION_NAME);

    const checkpointsCollectionName =
      process.env.MONGODB_CHECKPOINTS_COLLECTION_NAME ||
      "langgraph_checkpoints";
    langGraphCheckpointsCollection = db.collection(checkpointsCollectionName);

    checkpointer = new MongoDBSaver({
      client: mongoClient,
    });

    console.log(
      "MongoDB connected, chat history and checkpoints collections ready."
    );
  } catch (e: any) {
    console.error(`Failed to connect to MongoDB: ${e.message || e}`);
    mongoClient = null;
    chatSessionsCollection = null;
    langGraphCheckpointsCollection = null;
    checkpointer = null;
    throw e;
  }

  // Initialize Gemini LLM
  if (!GEMINI_API_KEY) {
    console.error(
      "Error: GEMINI_API_KEY not set or is placeholder. Cannot initialize LLM/Embeddings."
    );
    throw new Error("Gemini API key is missing.");
  }

  chatLLM = new ChatGoogleGenerativeAI({
    apiKey: GEMINI_API_KEY,
    model: LLM_MODEL_NAME,
    temperature: 0.7,
  });

  embeddings = new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: "http://localhost:11434",
  });
  console.log("Gemini LLM and Embeddings initialized.");

  // Initialize Pinecone
  if (!PINECONE_API_KEY || !PINECONE_ENVIRONMENT) {
    console.error(
      "Error: Pinecone API key or environment not set or are placeholders."
    );
    throw new Error("Pinecone credentials are missing.");
  }
  pineconeClient = new Pinecone({
    apiKey: PINECONE_API_KEY,
  });

  try {
    const indexList = await pineconeClient.listIndexes();
    const indexNames = indexList.indexes?.map((idx) => idx.name) ?? [];
    if (!indexNames.includes(PINECONE_INDEX_NAME)) {
      console.error(
        `Pinecone index '${PINECONE_INDEX_NAME}' does not exist. Please run the data ingestion script first.`
      );
      throw new Error(`Pinecone index '${PINECONE_INDEX_NAME}' not found.`);
    }
    pineconeVectorStore = new PineconeStore(embeddings, {
      pineconeIndex: pineconeClient.Index(PINECONE_INDEX_NAME),
    });
    console.log("Pinecone Vector Store initialized.");
  } catch (e: any) {
    console.error(
      `Failed to initialize Pinecone Vector Store: ${e.message || e}`
    );
    throw e;
  }

  // Initialize Neo4j
  if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
    console.error(
      "Error: Neo4j connection details not fully set or are placeholders."
    );
    throw new Error("Neo4j credentials are missing.");
  }
  neo4jDriver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
  );
  try {
    await neo4jDriver.verifyConnectivity();
    console.log("Neo4j driver connected successfully.");
  } catch (e: any) {
    console.error(`Failed to connect to Neo4j: ${e.message || e}`);
    throw e;
  }

  // NEW: Compile the graph AFTER all dependencies (including checkpointer) are initialized
  compileGraph();
  console.log("LangGraph compiled successfully.");

  console.log("Chat Service initialized successfully.");
}
