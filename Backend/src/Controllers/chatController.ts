import { Request, Response } from "express";
import { chat } from "../Services/main";


export const chatHandeler = async (req:Request, res:Response) => {
  const { message, sessionId } = req.body;

  if (!message) {
      res.status(400).json({ error: 'Message is required in the request body.' });
    return 
  }

  const userSessionId = sessionId ;

  console.log(`Received message: "${message}" for session: ${userSessionId}`);

  try {
    const response = await chat(message, userSessionId); 

    res.json({
      reply: response,
      sessionId: userSessionId,
    });
    return;

  } catch (error) {
    console.error('Error processing chat message:', error);
    res.status(500).json({ error: 'Failed to process your request. Please try again later.' });
  }
};
