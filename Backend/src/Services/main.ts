// Services/main.ts
import {
  chatLLM,
  chatSessionsCollection,
  initializeChatService,
  mongoClient,
  pineconeVectorStore,
} from "./initializeChatService";
import { graph } from "./LangGraphChain";
import { AgentState, getSessionMemory } from "./Memory";
import { ObjectId } from "mongodb";

// --- Initialization Call ---
initializeChatService().catch((err) => {
  console.error("Failed to initialize chat service on startup:", err);
  process.exit(1);
});

// --- Main Chat Function ---
export async function chat(
  userMessage: string,
  sessionId: string,
  imageData?: string // NEW: Optional imageData parameter
): Promise<{
  id: string;
  content: string;
  role: "assistant";
  timestamp: string;
}> {
  // Check if services are initialized. If not, attempt to re-initialize.
  if (
    !chatLLM ||
    !pineconeVectorStore ||
    !mongoClient ||
    !chatSessionsCollection
  ) {
    console.warn(
      "Chat service not fully initialized. Attempting to re-initialize."
    );
    try {
      await initializeChatService();
    } catch (e) {
      throw new Error(
        "I'm sorry, the chat service is not fully operational. Please try again later."
      );
    }
  }

  const memory = await getSessionMemory(sessionId);
  const chatHistory = await memory.loadMemoryVariables({});

  // Initialize AgentState with new fields, including imageData
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
    imageData: imageData, // NEW: Pass imageData into the initial state
  };

  console.log(
    `Starting graph execution for session ${sessionId} with question: ${userMessage}`
  );
  try {
    const finalState: AgentState = await graph.invoke(initialState);

    const aiResponse = finalState.llm_response;

    // Save the new turn to memory (MongoDBChatMessageHistory will handle persistence)
    await memory.saveContext({ question: userMessage }, { output: aiResponse });

    const lastAIMessageDoc = await chatSessionsCollection.findOne(
      { sessionId: sessionId, type: "ai", "data.content": aiResponse },
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
      };
    } else {
      console.warn(
        "Could not retrieve newly saved AI message from DB. Using generated ID/timestamp."
      );
      return {
        id: new Date().getTime().toString(),
        content: aiResponse,
        role: "assistant",
        timestamp: new Date().toISOString(),
      };
    }
  } catch (e: any) {
    console.error(
      `Error during graph execution for session ${sessionId}: ${e.message || e}`
    );
    throw new Error(e.message || "Failed to process your request.");
  }
}