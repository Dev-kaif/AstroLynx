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
}

// Function to get or create a memory instance for a session, now using MongoDBChatMessageHistory
export async function getSessionMemory(
  sessionId: string
): Promise<BufferWindowMemory> {
  if (!chatSessionsCollection) {
    throw new Error("MongoDB chat sessions collection is not initialized.");
  }

  // MongoDBChatMessageHistory handles loading/saving internally
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

  const retrievedContent = state.retrieved_docs
    .map((doc) => doc.pageContent)
    .filter((content) => content.length > 20)
    .join("\n---\n");

  // console.log("\n\n\n\n\n context from bulding ", retrievedContent, "\n\n\n\n");

  // Optional truncation for large retrieved content
  let context = retrievedContent || "No context provided.";
  if (
    chatLLM &&
    chatLLM.getNumTokens &&
    (await chatLLM.getNumTokens(context)) > CONTEXT_MAX_TOKENS
  ) {
    console.warn("Context too large. Truncating context for LLM.");
    const tokens = await chatLLM.getNumTokens(context);
    const ratio = CONTEXT_MAX_TOKENS / tokens;
    context = context.substring(Math.floor(context.length * (1 - ratio)));
    context = `(Context truncated due to length)\n${context}`;
  }

  return {
    context: context,
  };
}
