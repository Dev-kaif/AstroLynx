import { chatLLM, chatSessionsCollection, initializeChatService, mongoClient, pineconeVectorStore } from "./initializeChatService";
import { graph } from "./LangGraphChain";
import { AgentState, getSessionMemory } from "./Memory";



// --- Initialization Call ---
initializeChatService().catch((err) => {
  console.error("Failed to initialize chat service on startup:", err);
  process.exit(1); 
});


// --- Main Chat Function ---
export async function chat(
  userMessage: string,
  sessionId: string
): Promise<string> {
  // Check if services are initialized. If not, attempt to initialize.
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
      return "I'm sorry, the chat service is not fully operational. Please try again later.";
    }
  }
 
  
  const memory = await getSessionMemory(sessionId); 
  const chatHistory = await memory.loadMemoryVariables({}); 

  const initialState: AgentState = {
    question: userMessage,
    chat_history: chatHistory.chat_history,
    retrieved_docs: [],
    context:"",
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

    return aiResponse;
  } catch (e: any) {
    console.error(
      `Error during graph execution for session ${sessionId}: ${e.message || e}`
    );
    return "I apologize, but an unexpected error occurred while processing your request.";
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

// // Listen for process termination signals
// process.on("SIGINT", shutdownChatService);
// process.on("SIGTERM", shutdownChatService);
