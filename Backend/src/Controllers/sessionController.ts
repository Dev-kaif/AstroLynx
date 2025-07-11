// Controllers/sessionController.ts
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid"; // For generating unique session IDs
import { chatSessionsCollection } from "../Services/initializeChatService"; // Import your collection
import { getSessionMemory } from "../Services/Memory"; // Still needed for context but not directly for history retrieval here
import { ObjectId } from "mongodb"; // Import ObjectId for _id type

export const createSession = async (req: Request, res: Response) => {
  try {
    const newSessionId = uuidv4(); // Generate a unique UUID for the session

    console.log(`New session ID generated: ${newSessionId}`);

    // Send the new session ID back to the client
    res.status(201).json({
      sessionId: newSessionId,
      message: "New chat session created successfully.",
    });
  } catch (error) {
    console.error("Error creating new session:", error);
    res.status(500).json({
      error: "Failed to create a new session. Please try again later.",
    });
  }
};

export const getChatHistory = async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!sessionId) {
    res.status(400).json({ error: "Session ID is required." });
    return;
  }

  try {
    if (!chatSessionsCollection) {
      console.error("MongoDB chat sessions collection is not initialized.");
      throw new Error("Chat sessions collection is not initialized.");
    }

    // Find the single document for this sessionId
    const sessionDocument = await chatSessionsCollection.findOne({
      sessionId: sessionId,
    });

    let formattedHistory: any[] = [];

    if (sessionDocument && Array.isArray(sessionDocument.messages)) {
      // Get the timestamp from the session document's _id
      const sessionTimestamp = (sessionDocument._id as ObjectId)
        .getTimestamp()
        .toISOString();

      // Iterate over the 'messages' array within the session document
      formattedHistory = sessionDocument.messages.map(
        (msg: any, index: number) => {
          // Each message in the 'messages' array has 'type' and 'data.content'
          const content = msg.data?.content || "";
          const type = msg.type; // 'human' or 'ai'

          // Generate a unique ID for each message for the frontend
          // Using a combination of session ID, index, and timestamp for robust uniqueness
          const messageId = `${sessionDocument._id.toString()}-${index}`;

          return {
            id: messageId,
            role: type === "human" ? "user" : "assistant", // Map 'human' to 'user', 'ai' to 'assistant'
            content: content,
            timestamp: sessionTimestamp, // Use the session document's timestamp for all messages in this batch
          };
        }
      );
    } else {
      console.log(
        `No messages array found or session document is empty for session: ${sessionId}`
      );
    }

    res.status(200).json({
      sessionId: sessionId,
      history: formattedHistory,
      message: "Chat history retrieved successfully.",
    });
  } catch (error) {
    console.error(
      `Error retrieving chat history for session ${sessionId}:`,
      error
    );
    res.status(500).json({
      error: "Failed to retrieve chat history. Please try again later.",
    });
  }
};
