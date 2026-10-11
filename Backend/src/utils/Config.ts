import { env } from "../config/env";

// Keep the legacy service imports source-compatible while representing absent
// optional provider settings explicitly as empty strings at this boundary.
export const JWT_SECRET = env.JWT_SECRET ?? "";
export const GEMINI_API_KEY = env.GEMINI_API_KEY ?? "";
export const LLM_MODEL_NAME = env.GEMINI_MODEL;
export const PINECONE_API_KEY = env.PINECONE_API_KEY ?? "";
export const PINECONE_ENVIRONMENT = env.PINECONE_ENVIRONMENT ?? "";
export const PINECONE_INDEX_NAME = env.PINECONE_INDEX_NAME ?? "";
export const NEO4J_URI = env.NEO4J_URI ?? "";
export const NEO4J_USERNAME = env.NEO4J_USERNAME ?? "";
export const NEO4J_PASSWORD = env.NEO4J_PASSWORD ?? "";
export const MONGO_URI = env.MONGO_URI ?? "";
export const MONGO_DB_NAME = env.MONGO_DB_NAME ?? "";
export const MONGO_COLLECTION_NAME = env.MONGO_COLLECTION_NAME ?? "";
export const MONGO_MESSAGES_COLLECTION_NAME = env.MONGO_MESSAGES_COLLECTION_NAME;
export const SARVAM_AI_API_KEY = env.SARVAM_AI_API_KEY;
export const OLLAMA_BASE_URL = env.OLLAMA_BASE_URL;
