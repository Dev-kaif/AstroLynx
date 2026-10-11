// Services/main.ts
import { randomUUID } from "node:crypto";
import {
  chatLLM,
  chatSessionsCollection,
  chatMessagesCollection,
  initializeChatService,
  mongoClient,
  pineconeVectorStore,
} from "./initializeChatService";
import { graph } from "./LangGraphChain";
import { AgentState, EvidenceCitation, boundChatHistory, getSessionMemory } from "./Memory";
import { logStageTiming, startTimer } from "../utils/performanceLog";

export async function chat(
  userMessage: string,
  sessionId: string,
  imageData?: string,
  isAudioMode: boolean = false,
  targetLanguage: string = "en",
  signal?: AbortSignal
): Promise<{
  id: string;
  content: string;
  role: "assistant";
  timestamp: string;
  audioData?: string;
  citations: EvidenceCitation[];
}> {
  const turnStartedAt = startTimer();
  if (
    !chatLLM ||
    !pineconeVectorStore ||
    !mongoClient ||
    !chatSessionsCollection ||
    !chatMessagesCollection ||
    !graph
  ) {
    console.warn(
      "Chat service not fully initialized or graph not compiled. Attempting to re-initialize."
    );
    try {
      const initializationStartedAt = startTimer();
      await initializeChatService();
      logStageTiming("service_initialization", initializationStartedAt, { outcome: "completed" });
      if (!graph) {
        console.warn(
          "Graph was not compiled during re-initialization, attempting manual compile."
        );
      }
    } catch (e) {
      throw new Error(
        "I'm sorry, the chat service is not fully operational. Please try again later."
      );
    }
  }

  if (!graph) {
    throw new Error("Chat graph is not available after initialization.");
  }
  const activeGraph = graph;

  const historyStartedAt = startTimer();
  const memory = await getSessionMemory(sessionId);
  const chatHistory = await memory.loadMemoryVariables({});
  logStageTiming("history_load", historyStartedAt, {
    messageCount: chatHistory.chat_history?.length ?? 0,
  });

  const initialState: AgentState = {
    question: userMessage,
    chat_history: boundChatHistory(chatHistory.chat_history ?? []),
    retrieved_docs: [],
    context: "",
    llm_response: "",
    rewritten_queries: [],
    hypothetical_doc_query: null,
    raw_pinecone_results: [],
    raw_lexical_results: [],
    rrf_ranked_docs: [],
    imageData: imageData,
    targetLanguage: targetLanguage,
    isAudioMode: isAudioMode,
    audioData: null,
  };

  console.log("Starting chat graph execution.");
  try {
    const graphStartedAt = startTimer();
    const finalState: AgentState = await activeGraph.invoke(initialState, {
      signal,
    });
    logStageTiming("graph_execution", graphStartedAt, {
      citationCount: finalState.citations?.length ?? 0,
      outcome: "completed",
    });
    signal?.throwIfAborted();

    // Keep source IDs internal until ingestion provides stable, user-facing
    // MOSDAC links. The answer is still grounded and validated in the graph.
    const generatedAnswer = (finalState.llm_response || "No response generated.")
      .replace(/\s*\[S\d+\]/gu, "")
      .trim();
    const citations = finalState.citations ?? [];
    const finalAiResponse = generatedAnswer;
    const audioDataBase64 = finalState.audioData;

    const persistenceStartedAt = startTimer();
    await memory.saveContext(
      { question: userMessage },
      { output: finalAiResponse }
    );
    logStageTiming("history_persist", persistenceStartedAt, { outcome: "completed" });
    logStageTiming("chat_turn", turnStartedAt, {
      outcome: "completed",
      citationCount: citations.length,
    });

    return {
      id: randomUUID(),
      content: finalAiResponse,
      role: "assistant",
      timestamp: new Date().toISOString(),
      audioData: audioDataBase64,
      citations,
    };
  } catch (e: unknown) {
    logStageTiming("chat_turn", turnStartedAt, {
      outcome: signal?.aborted ? "cancelled" : "error",
      errorType: e instanceof Error ? e.name : "unknown",
    });
    console.error("Chat graph execution failed:", e instanceof Error ? e.name : "unknown error");
    throw new Error("Failed to process your request.");
  }
}
