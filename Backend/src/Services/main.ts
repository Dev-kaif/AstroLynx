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
import { textToSpeechController } from "../Controllers/textToSpeechController";

// --- Initialization Call ---
initializeChatService().catch((err) => {
  console.error("Failed to initialize chat service on startup:", err);
  process.exit(1);
});

// --- Main Chat Function ---
export async function chat(
  userMessage: string,
  sessionId: string,
  imageData?: string,
  isAudioMode: boolean = false // NEW: Optional parameter for audio mode
): Promise<{
  id: string;
  content: string;
  role: "assistant";
  timestamp: string;
  audioData?: string; // NEW: Optional audio data (Base64)
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
    imageData: imageData,
  };

  console.log(
    `Starting graph execution for session ${sessionId} with question: ${userMessage}`
  );
  try {
    const finalState: AgentState = await graph.invoke(initialState);

    const aiResponse = finalState.llm_response;
    let audioDataBase64: string | undefined;

    if (isAudioMode && aiResponse) {
      console.log(
        "Audio mode active: Generating speech from AI response via Sarvam AI."
      );
      const mockReq: any = {
        body: {
          text: aiResponse,
          target_language_code: "en-IN",
          speaker: "anushka",
        },
      };
      const mockRes: any = {
        json: (data: any) => {
          audioDataBase64 = data.audioData;
          return mockRes;
        },
        status: (code: number) => {
          if (code !== 200) {
            console.error(
              `Sarvam AI TTS mock response status: ${code}. Data: ${JSON.stringify(
                mockRes._data
              )}`
            );
          }
          mockRes._status = code; // Store status for debugging if needed
          return mockRes;
        },
        // Add a send method to capture data for the mock response
        send: (data: any) => {
          mockRes._data = data;
          return mockRes;
        },
        set: () => mockRes, // Mock set method for headers if needed
      };

      try {
        await textToSpeechController(mockReq, mockRes);
      } catch (ttsError: any) {
        console.error(
          `Error generating speech in main.ts: ${ttsError.message || ttsError}`
        );
        // Do not re-throw, allow text response to proceed
      }
    }

    // Save the new turn to memory (MongoDBChatMessageHistory will handle persistence)
    await memory.saveContext({ question: userMessage }, { output: aiResponse });

    // Retrieve the just-saved AI message to ensure we have its ID and timestamp
    // This query is specific and might need adjustment based on how MongoDB stores Langchain messages.
    // Assuming 'data.content' holds the actual message content.
    const lastAIMessageDoc = await chatSessionsCollection.findOne(
      { sessionId: sessionId, "data.content": aiResponse }, // Match by session and content
      { sort: { _id: -1 } } // Get the most recent one
    );

    if (lastAIMessageDoc) {
      const timestamp = (lastAIMessageDoc._id as ObjectId).getTimestamp();
      return {
        id: lastAIMessageDoc._id.toString(),
        content:
          lastAIMessageDoc.data?.content || lastAIMessageDoc.content || "",
        role: "assistant",
        timestamp: timestamp.toISOString(),
        audioData: audioDataBase64, // Include audio data
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
        audioData: audioDataBase64, // Include audio data
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
