import dotenv from 'dotenv';
dotenv.config();


export const JWT_SECRET = process.env.JWT_SECRET as string;

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY as string;
export const LLM_MODEL_NAME = process.env.GEMINI_MODEL as string; 


export const PINECONE_API_KEY = process.env.PINECONE_API_KEY as string;
export const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT as string;
export const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME as string;

export const NEO4J_URI = process.env.NEO4J_URI as string;
export const NEO4J_USERNAME = process.env.NEO4J_USERNAME as string;
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD as string;

export const MONGO_URI = process.env.MONGO_URI as string;
export const MONGO_DB_NAME =  process.env.MONGO_DB_NAME as string;
export const MONGO_COLLECTION_NAME =  process.env.MONGO_COLLECTION_NAME as string;

export const SARVAM_AI_API_KEY = process.env.SARVAM_AI_API_KEY;