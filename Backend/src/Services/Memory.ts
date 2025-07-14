// Services/Memory.ts
import { MongoDBChatMessageHistory } from "@langchain/mongodb";
import { BufferWindowMemory } from "langchain/memory";
import { chatSessionsCollection } from "./initializeChatService";

import { BaseMessage } from "@langchain/core/messages";
import { chatLLM } from "./initializeChatService";
import { Document } from "@langchain/core/documents";

const CONTEXT_MAX_TOKENS = 4000;
const MEMORY_WINDOW_SIZE = 10;

export interface AgentState {
  question: string;
  chat_history: BaseMessage[];
  retrieved_docs: Document[];
  neo4j_data: string;
  llm_response: string;
  context?: string;

  rewritten_queries?: string[];
  hypothetical_doc_query?: string;
  raw_pinecone_results?: Document[][];
  rrf_ranked_docs?: Document[];

  imageData?: string;
  targetLanguage?: string;
  isAudioMode?: boolean; 
  audioData?: string;
}

export async function getSessionMemory(
  sessionId: string
): Promise<BufferWindowMemory> {
  if (!chatSessionsCollection) {
    throw new Error("MongoDB chat sessions collection is not initialized.");
  }

  const chatHistory = new MongoDBChatMessageHistory({
    collection: chatSessionsCollection,
    sessionId: sessionId,
  });

  const memory = new BufferWindowMemory({
    k: MEMORY_WINDOW_SIZE,
    returnMessages: true,
    memoryKey: "chat_history",
    inputKey: "question",
    chatHistory: chatHistory,
  });

  return memory;
}

export async function buildContext(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log("LangGraph Node: buildContext");

  const pineconeContent = state.rrf_ranked_docs
    ?.map((doc) => doc.pageContent)
    .filter((content) => content.length > 20)
    .join("\n---\n");

  let context = "";
  if (pineconeContent) {
    context += `Vector Search Results:\n${pineconeContent}\n\n`;
  } else {
    context +=
      "Vector Search Results: No relevant information found from Pinecone.\n\n";
  }

  // Add Neo4j data if available
  if (
    state.neo4j_data &&
    state.neo4j_data !== "No relevant semantic nodes found in Neo4j." &&
    !state.neo4j_data.startsWith("Error retrieving semantic relations")
  ) {
    context += `Knowledge Graph Data:\n${state.neo4j_data}\n\n`;
  } else {
    context +=
      "Knowledge Graph Data: No relevant information found from Neo4j.\n\n";
  }

  console.log("Context built for LLM: \n", context, "\n\n\n\n");

  if (
    chatLLM &&
    chatLLM.getNumTokens &&
    (await chatLLM.getNumTokens(context)) > CONTEXT_MAX_TOKENS
  ) {
    console.warn("Context too large. Truncating context for LLM.");
    const tokens = await chatLLM.getNumTokens(context);
    const ratio = CONTEXT_MAX_TOKENS / tokens;
    context = context.substring(0, Math.floor(context.length * ratio));
  }

  return { context: context, retrieved_docs: state.rrf_ranked_docs || [] };
}
