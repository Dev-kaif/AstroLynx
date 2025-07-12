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
import { translateToEnglish, translateToTargetLanguage } from "./translateText"; 

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
  isAudioMode: boolean = false,
  targetLanguage: string = 'en' 
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

  let processedUserMessage = userMessage;
  let finalAiResponse = "";

  if (targetLanguage !== 'en') {
    try {
      console.log(`[Multi-Lang] Translating user message from ${targetLanguage} to English...`);
      processedUserMessage = await translateToEnglish(userMessage, targetLanguage);
      console.log(`[Multi-Lang] User message translated to English: "${processedUserMessage}"`);
    } catch (translationError) {
      console.error("[Multi-Lang] Error translating user message to English:", translationError);
      // Fallback: proceed with original message if translation fails
      processedUserMessage = userMessage;
      // In a real app, you might want to send a warning message to the user here.
    }
  }

  // Initialize AgentState with new fields, including imageData
  const initialState: AgentState = {
    question: processedUserMessage, // Use the (potentially translated) English message here for LLM processing
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
    `Starting graph execution for session ${sessionId} with question: ${processedUserMessage}`
  );
  try {
    const finalState: AgentState = await graph.invoke(initialState);

    const aiResponseEnglish = finalState.llm_response;
    let audioDataBase64: string | undefined;

    if (targetLanguage !== 'en') {
      try {
        console.log(`[Multi-Lang] Translating AI response from English to ${targetLanguage}...`);
        finalAiResponse = await translateToTargetLanguage(aiResponseEnglish, targetLanguage);
        console.log(`[Multi-Lang] AI response translated to ${targetLanguage}: "${finalAiResponse}"`);
      } catch (translationError) {
        console.error("[Multi-Lang] Error translating AI response to target language:", translationError);
        finalAiResponse = aiResponseEnglish;
      }
    } else {
      finalAiResponse = aiResponseEnglish; // If target language is English, use it directly
    }

    // If audio mode is requested, generate speech from the FINAL (potentially translated) AI response
    if (isAudioMode && finalAiResponse) {
      console.log("Audio mode active: Generating speech from AI response via Sarvam AI.");
      // Mock Express Request and Response objects for internal call to controller
      const mockReq: any = {
        body: { text: finalAiResponse, target_language_code: targetLanguage, speaker: "anushka" }, // NEW: Pass targetLanguage to TTS
      };
      const mockRes: any = {
        json: (data: any) => {
          audioDataBase64 = data.audioData;
          return mockRes;
        },
        status: (code: number) => {
          if (code !== 200) {
            console.error(`Sarvam AI TTS mock response status: ${code}. Data: ${JSON.stringify(mockRes._data)}`);
          }
          mockRes._status = code;
          return mockRes;
        },
        send: (data: any) => {
            mockRes._data = data;
            return mockRes;
        },
        set: () => mockRes,
      };

      try {
        await textToSpeechController(mockReq, mockRes);
      } catch (ttsError: any) {
        console.error(`Error generating speech in main.ts: ${ttsError.message || ttsError}`);
        // Do not re-throw, allow text response to proceed
      }
    }

    // Save the new turn to memory (MongoDBChatMessageHistory will handle persistence)
    // IMPORTANT: Save the ORIGINAL user message and the FINAL (potentially translated) AI response
    await memory.saveContext({ question: userMessage }, { output: finalAiResponse });

    // Retrieve the just-saved AI message to ensure we have its ID and timestamp
    const lastAIMessageDoc = await chatSessionsCollection.findOne(
      { sessionId: sessionId, "data.content": finalAiResponse }, // Match by session and content
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
        content: finalAiResponse,
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