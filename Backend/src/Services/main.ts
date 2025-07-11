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
import { ObjectId } from "mongodb"; // Import ObjectId

// --- Initialization Call ---
initializeChatService().catch((err) => {
  console.error("Failed to initialize chat service on startup:", err);
  process.exit(1);
});

// --- Main Chat Function ---
export async function chat(
  userMessage: string,
  sessionId: string
): Promise<{
  id: string;
  content: string;
  role: "assistant";
  timestamp: string;
}> {
  // Updated return type
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

  const initialState: AgentState = {
    question: userMessage,
    chat_history: chatHistory.chat_history,
    retrieved_docs: [],
    context: "",
    neo4j_data: "",
    llm_response: "",
  };

  console.log(
    `Starting graph execution for session ${sessionId} with question: ${userMessage}`
  );
  try {
    const finalState: AgentState = await graph.invoke(initialState);

    const aiResponse = finalState.llm_response;

    // Save the new turn to memory (MongoDBChatMessageHistory will handle persistence)
    await memory.saveContext({ question: userMessage }, { output: aiResponse });

    // After saving, retrieve the *just saved* AI message from MongoDB
    // This allows us to get its actual _id and creation timestamp from the database.
    const lastAIMessageDoc = await chatSessionsCollection.findOne(
      { sessionId: sessionId, type: "ai", "data.content": aiResponse }, // Find the specific AI message by content and type for this session
      { sort: { _id: -1 } } // Get the most recent one to ensure it's the one we just saved
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
      // Fallback if the just-saved message isn't found immediately (should be rare)
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
    // Re-throw the error so chatHandeler can catch it and return a 500
    throw new Error(e.message || "Failed to process your request.");
  }
}

// --- Graceful Shutdown ---
// async function shutdownChatService(): Promise<void> {
//   console.log("Shutting down chat service...");
//   // if (neo4jDriver) {
//   //   await neo4jDriver.close();
//   //   console.log("Neo4j driver closed.");
//   // }
//   if (mongoClient) {
//     await mongoClient.close();
//     console.log("MongoDB client closed.");
//   }
//   console.log("Chat service shutdown complete.");
// }

// // Listen for...
