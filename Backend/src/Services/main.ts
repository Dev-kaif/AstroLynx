// Services/main.ts
import {
  chatLLM,
  chatSessionsCollection,
  initializeChatService,
  mongoClient,
  pineconeVectorStore,
  checkpointer,
} from "./initializeChatService";
import { graph } from "./LangGraphChain";
import { AgentState, getSessionMemory } from "./Memory";
import { ObjectId } from "mongodb";

// --- Initialization Call ---
initializeChatService().catch((err) => {
  console.error("Failed to initialize chat service on startup:", err);
  process.exit(1);
});

export async function chat(
  userMessage: string,
  sessionId: string,
  imageData?: string,
  isAudioMode: boolean = false,
  targetLanguage: string = "en"
): Promise<{
  id: string;
  content: string;
  role: "assistant";
  timestamp: string;
  audioData?: string;
}> {
  if (
    !chatLLM ||
    !pineconeVectorStore ||
    !mongoClient ||
    !chatSessionsCollection ||
    !checkpointer ||
    !graph
  ) {
    console.warn(
      "Chat service not fully initialized or graph not compiled. Attempting to re-initialize."
    );
    try {
      await initializeChatService();
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

  const memory = await getSessionMemory(sessionId);
  const chatHistory = await memory.loadMemoryVariables({});

  const initialState: AgentState = {
    question: userMessage,
    chat_history: chatHistory.chat_history,
    retrieved_docs: [],
    context: "",
    neo4j_data: "",
    llm_response: "",
    rewritten_queries: [],
    hypothetical_doc_query: null,
    raw_pinecone_results: [],
    rrf_ranked_docs: [],
    imageData: imageData,
    targetLanguage: targetLanguage,
    isAudioMode: isAudioMode,
    audioData: null,
  };

  console.log(
    `Starting graph execution for session ${sessionId} with original question: ${userMessage}`
  );
  try {
    const finalState: AgentState = await graph.invoke(initialState, {
      configurable: { thread_id: sessionId },
    });

    const finalAiResponse = finalState.llm_response || "No response generated.";
    const audioDataBase64 = finalState.audioData;

    await memory.saveContext(
      { question: userMessage },
      { output: finalAiResponse }
    );

    const lastAIMessageDoc = await chatSessionsCollection.findOne(
      { sessionId: sessionId, "data.content": finalAiResponse },
      { sort: { _id: -1 } }
    );

    if (lastAIMessageDoc) {
      const timestamp = (lastAIMessageDoc._id as ObjectId).getTimestamp();
      return {
        id: lastAIMessageDoc._id.toString(),
        content:
          lastAIMessageDoc.data?.content || lastAIMessageDoc.content || "",
        role: "assistant",
        timestamp: timestamp.toISOString(),
        audioData: audioDataBase64,
      };
    } else {
      console.warn(
        "Could not retrieve newly saved AI message from DB. Using generated ID/timestamp."
      );
      return {
        id: new Date().getTime().toString(),
        content: finalAiResponse,
        role: "assistant",
        timestamp: new Date().toISOString(),
        audioData: audioDataBase64,
      };
    }
  } catch (e: any) {
    console.error(
      `Error during graph execution for session ${sessionId}: ${e.message || e}`
    );
    throw new Error(e.message || "Failed to process your request.");
  }
}
