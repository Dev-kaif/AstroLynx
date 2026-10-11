import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import { Collection, MongoClient } from "mongodb";
import {
  GEMINI_API_KEY,
  LLM_MODEL_NAME,
  MONGO_COLLECTION_NAME,
  MONGO_DB_NAME,
  MONGO_MESSAGES_COLLECTION_NAME,
  MONGO_URI,
  OLLAMA_BASE_URL,
  PINECONE_API_KEY,
  PINECONE_INDEX_NAME,
} from "../utils/Config";


// Import the compileGraph function
import { compileGraph } from "./LangGraphChain";
import { env } from "../config/env";
import { CachedOllamaEmbeddings, QUERY_EMBEDDING_MODEL } from "./cachedEmbeddings";

// --- Database & LLM Initializations ---
export let pineconeClient: Pinecone | null = null;
export let pineconeVectorStore: PineconeStore | null = null;
export let chatLLM: ChatGoogleGenerativeAI | null = null;
export let embeddings: CachedOllamaEmbeddings | null = null;

export let mongoClient: MongoClient | null = null;
export let chatSessionsCollection: Collection | null = null;
export let chatMessagesCollection: Collection | null = null;

/** Extend the older Core 0.3 adapter's model-name check to Gemini 3 models. */
class Gemini3CompatibleChatGoogleGenerativeAI extends ChatGoogleGenerativeAI {
  override get _isMultimodalModel(): boolean {
    const modelName = this.model.replace(/^models\//u, "");
    return modelName.startsWith("gemini-3") || super._isMultimodalModel;
  }
}

let initializationPromise: Promise<void> | null = null;
let mongoInitializationPromise: Promise<void> | null = null;

async function initializeMongoChatStorageInternal(): Promise<void> {
  if (chatSessionsCollection && chatMessagesCollection && mongoClient) return;
  if (!MONGO_URI || !MONGO_DB_NAME || !MONGO_COLLECTION_NAME) {
    throw new Error("MongoDB credentials are missing.");
  }

  const client = new MongoClient(MONGO_URI);
  mongoClient = client;
  try {
    await client.connect();
    const db = client.db(MONGO_DB_NAME);
    const sessions = db.collection(MONGO_COLLECTION_NAME);
    const messages = db.collection(MONGO_MESSAGES_COLLECTION_NAME);
    await sessions.createIndex({ ownerId: 1, updatedAt: -1 });
    await messages.createIndex({ sessionId: 1, createdAt: -1, _id: -1 });
    await db.collection("astrolynx_users").createIndex({ email: 1 }, { unique: true });
    const authSessions = db.collection("astrolynx_auth_sessions");
    await authSessions.createIndex({ tokenHash: 1 }, { unique: true });
    await authSessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    chatSessionsCollection = sessions;
    chatMessagesCollection = messages;
    console.log("MongoDB connected; chat history collection ready.");
  } catch (error: unknown) {
    const mongoError = error as { code?: unknown };
    if (mongoError.code === 8000 || mongoError.code === 18) {
      console.error(
        "MongoDB authentication failed. Check the Atlas database user's username/password and URL-encode any special characters in the URI credentials."
      );
    } else {
      console.error("MongoDB connection failed:", error instanceof Error ? error.name : "unknown error");
    }
    if (mongoClient === client) {
      mongoClient = null;
      chatSessionsCollection = null;
      chatMessagesCollection = null;
    }
    await client.close().catch(() => undefined);
    throw error;
  }
}

/** Initialize only Mongo-backed conversation storage for history API requests. */
export function initializeMongoChatStorage(): Promise<void> {
  if (mongoClient && chatSessionsCollection && chatMessagesCollection) return Promise.resolve();
  if (mongoInitializationPromise) return mongoInitializationPromise;

  const request = initializeMongoChatStorageInternal();
  mongoInitializationPromise = request;
  void request.finally(() => {
    if (mongoInitializationPromise === request) mongoInitializationPromise = null;
  }).catch(() => undefined);
  return request;
}

async function initializeChatServiceInternal(): Promise<void> {
  console.log("Initializing Chat Service...");

  // MongoDB is the persisted chat-history source of truth. Graph runs are
  // request-scoped and do not need checkpoint persistence.
  await initializeMongoChatStorage();

  // Initialize Gemini LLM
  if (!GEMINI_API_KEY) {
    console.error(
      "Error: GEMINI_API_KEY not set or is placeholder. Cannot initialize LLM/Embeddings."
    );
    throw new Error("Gemini API key is missing.");
  }

  chatLLM = new Gemini3CompatibleChatGoogleGenerativeAI({
    apiKey: GEMINI_API_KEY,
    model: LLM_MODEL_NAME,
    temperature: env.GEMINI_TEMPERATURE,
    maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS,
    // Avoid the adapter's long retry cascade turning a provider error into an
    // ~80 second wait. One retry still covers short transient failures.
    maxRetries: 1,
  });

  embeddings = new CachedOllamaEmbeddings({
    model: QUERY_EMBEDDING_MODEL,
    baseUrl: OLLAMA_BASE_URL,
  });
  console.log("Gemini LLM and cached Ollama query embeddings initialized.");

  // Initialize Pinecone
  if (!PINECONE_API_KEY) {
    console.error(
      "Error: Pinecone API key is missing."
    );
    throw new Error("Pinecone credentials are missing.");
  }
  pineconeClient = new Pinecone({
    apiKey: PINECONE_API_KEY,
  });

  try {
    const indexList = await pineconeClient.listIndexes();
    const indexModel = indexList.indexes?.find((index) => index.name === PINECONE_INDEX_NAME);
    if (!indexModel) {
      console.error(
        `Pinecone index '${PINECONE_INDEX_NAME}' does not exist. Please run the data ingestion script first.`
      );
      throw new Error(`Pinecone index '${PINECONE_INDEX_NAME}' not found.`);
    }
    if (indexModel.vectorType !== "dense") {
      throw new Error(`Pinecone index '${PINECONE_INDEX_NAME}' is not a dense-vector index.`);
    }
    if (indexModel.embed?.model && indexModel.embed.model !== QUERY_EMBEDDING_MODEL) {
      throw new Error(
        `Pinecone index embedding model '${indexModel.embed.model}' does not match configured query model '${QUERY_EMBEDDING_MODEL}'.`
      );
    }
    if (!indexModel.embed?.model) {
      console.warn(
        "Pinecone does not report an embedding model for this index; only vector dimension can be checked. Confirm the indexed documents used the configured query model."
      );
    }
    if (!Number.isInteger(indexModel.dimension) || !indexModel.dimension || indexModel.dimension < 1) {
      throw new Error(`Pinecone index '${PINECONE_INDEX_NAME}' does not report a valid dense vector dimension.`);
    }
    embeddings.setExpectedDimension(indexModel.dimension);
    pineconeVectorStore = new PineconeStore(embeddings, {
      pineconeIndex: pineconeClient.Index(PINECONE_INDEX_NAME),
    });
    console.log(`Pinecone Vector Store initialized (${indexModel.dimension}-dimension index).`);
  } catch (e: unknown) {
    console.error("Pinecone initialization failed:", e instanceof Error ? e.name : "unknown error");
    throw e;
  }

  // Compile a request-scoped graph without persisting duplicate turn state.
  compileGraph();
  console.log("LangGraph compiled successfully.");

  console.log("Chat Service initialized successfully.");
}

/** Share concurrent startup work and release partially opened resources on failure. */
export function initializeChatService(): Promise<void> {
  if (initializationPromise) return initializationPromise;

  initializationPromise = initializeChatServiceInternal().catch(async (error) => {
    const mongoToClose = mongoClient;
    mongoClient = null;
    chatSessionsCollection = null;
    chatMessagesCollection = null;
    pineconeClient = null;
    pineconeVectorStore = null;
    chatLLM = null;
    embeddings = null;

    await Promise.allSettled([
      mongoToClose?.close(),
    ]);
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

/** Close lazy service connections after the HTTP server has drained requests. */
export async function closeChatService(): Promise<void> {
  const pendingInitialization = initializationPromise;
  const pendingMongoInitialization = mongoInitializationPromise;
  await Promise.all([
    pendingInitialization?.catch(() => undefined),
    pendingMongoInitialization?.catch(() => undefined),
  ]);

  const mongoToClose = mongoClient;
  mongoClient = null;
  chatSessionsCollection = null;
  chatMessagesCollection = null;
  pineconeClient = null;
  pineconeVectorStore = null;
  chatLLM = null;
  embeddings = null;
  initializationPromise = null;
  mongoInitializationPromise = null;

  const results = await Promise.allSettled([
    mongoToClose?.close(),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("One or more chat service connections failed to close cleanly.");
  }
}
