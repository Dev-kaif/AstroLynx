// src/Controllers/chatController.ts
import { Request, Response } from "express";
import { chat } from "../Services/main";

export const chatHandeler = async (req: Request, res: Response) => {
  const { message, sessionId, imageData, isAudioMode } = req.body;

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

  try {
    const response = await chat(message, userSessionId, imageData, isAudioMode);

    res.json({
      aiMessage: response, 
      sessionId: userSessionId,
    });
    return;

  } catch (error: any) {
    console.error('Error processing chat message:', error);
    res.status(500).json({ error: error.message || 'Failed to process your request. Please try again later.' });
  }
};