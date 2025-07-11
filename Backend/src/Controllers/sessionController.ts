import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid"; // For generating unique session IDs
import { chatSessionsCollection } from "../Services/initializeChatService"; // Import your collection
import { getSessionMemory } from "../Services/Memory";


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
    res
      .status(500)
      .json({
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
    // Get the LangChain memory instance for this session
    const memory = await getSessionMemory(sessionId);

    // Directly access the chatHistory from the memory instance (which is MongoDBChatMessageHistory)
    // and call its getMessages() method to retrieve all messages.
    // This bypasses the BufferWindowMemory's 'k' limit.
    const chatHistory = await memory.chatHistory.getMessages();

    // Format the history for the frontend (e.g., convert BaseMessage to plain objects)
    const formattedHistory = chatHistory.map((msg: any) => ({
      type: msg._getType(), // 'human' or 'ai'
      content: msg.content,
    }));

    console.log(
      `Retrieved ${formattedHistory.length} messages for session: ${sessionId}`
    );
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
    res
      .status(500)
      .json({
        error: "Failed to retrieve chat history. Please try again later.",
      });
  }
};
