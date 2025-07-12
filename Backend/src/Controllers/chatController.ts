// src/Controllers/chatController.ts
import { Request, Response } from "express";
import { chat } from "../Services/main";

export const chatHandeler = async (req: Request, res: Response) => {
  // Destructure message, sessionId, imageData, isAudioMode, and NEW: targetLanguage from the request body
  const { message, sessionId, imageData, isAudioMode, targetLanguage } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Message is required in the request body.' });
    return;
  }

  const userSessionId = sessionId;

  console.log(`Received message: "${message}" for session: ${userSessionId}`);
  if (imageData) {
    console.log(`Received image data (length: ${imageData.length}) in chat request.`);
  }
  if (isAudioMode) {
    console.log("Audio mode requested by frontend.");
  }
  if (targetLanguage) { // NEW: Log target language
    console.log(`Target language requested: ${targetLanguage}`);
  }

  try {
    // Pass targetLanguage to the chat service function (NEW ARGUMENT)
    const response = await chat(message, userSessionId, imageData, isAudioMode, targetLanguage);

    // Send back the full response object, which now includes audioData if present
    res.json({
      aiMessage: response, // This object now contains id, content, role, timestamp, and potentially audioData
      sessionId: userSessionId,
    });
    return;

  } catch (error: any) {
    console.error('Error processing chat message:', error);
    res.status(500).json({ error: error.message || 'Failed to process your request. Please try again later.' });
  }
};