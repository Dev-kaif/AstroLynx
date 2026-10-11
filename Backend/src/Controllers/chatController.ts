// src/Controllers/chatController.ts
import { Request, Response } from "express";
import { z } from "zod";
import { chat } from "../Services/main";
import {
  chatSessionsCollection,
  initializeMongoChatStorage,
} from "../Services/initializeChatService";
import {
  fallbackConversationTitle,
  generateConversationTitle,
} from "../Services/conversationTitles";

const chatRequestSchema = z.object({
  message: z.string().trim().max(8_000).optional().default(""),
  sessionId: z.string().uuid(),
  imageData: z.string()
    .max(7_000_000)
    .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u)
    .optional(),
  isAudioMode: z.boolean().optional().default(false),
  targetLanguage: z.enum(["en", "es", "fr", "hi", "hi-en", "de"]).optional().default("en"),
}).superRefine((body, context) => {
  if (!body.message && !body.imageData) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["message"],
      message: "Provide a non-empty message or an image.",
    });
  }
});

export const chatHandeler = async (req: Request, res: Response) => {
  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid chat request.", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { message, sessionId, imageData, isAudioMode, targetLanguage } = parsed.data;
  const abortController = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    await initializeMongoChatStorage();
    if (!chatSessionsCollection || !req.authUser) {
      res.status(503).json({ error: "Conversation storage is unavailable." });
      return;
    }
    const conversation = await chatSessionsCollection.findOne(
      { sessionId, ownerId: req.authUser.userId },
      { projection: { title: 1 } },
    );
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const response = await chat(
      message,
      sessionId,
      imageData,
      isAudioMode,
      targetLanguage,
      abortController.signal
    );
    const timestamp = new Date();
    const isFirstQuestion = conversation.title === "New chat";
    const titleSource = message || (imageData ? "User shared an image" : "New chat");
    let shouldGenerateTitle = false;
    if (isFirstQuestion) {
      const updated = await chatSessionsCollection.updateOne(
        { sessionId, ownerId: req.authUser.userId, title: "New chat" },
        { $set: {
          title: fallbackConversationTitle(titleSource),
          titleStatus: "generating",
          updatedAt: timestamp,
        } },
      );
      shouldGenerateTitle = updated.modifiedCount > 0;
    } else {
      await chatSessionsCollection.updateOne(
        { sessionId, ownerId: req.authUser.userId },
        { $set: { updatedAt: timestamp } },
      );
    }
    res.json({
      aiMessage: response,
      sessionId,
    });
    if (shouldGenerateTitle) {
      void generateConversationTitle(titleSource)
        .then((title) => chatSessionsCollection?.updateOne(
          { sessionId, ownerId: req.authUser!.userId, titleStatus: "generating" },
          { $set: { title, titleStatus: "ready", updatedAt: timestamp } },
        ))
        .catch(async (error: unknown) => {
          console.warn("Conversation title generation failed; keeping the question-based title.");
          await chatSessionsCollection?.updateOne(
            { sessionId, ownerId: req.authUser!.userId, titleStatus: "generating" },
            { $set: { titleStatus: "ready" } },
          ).catch(() => undefined);
        });
    }
  } catch (error: unknown) {
    if (abortController.signal.aborted || res.destroyed) return;
    console.error("Chat request failed:", error instanceof Error ? error.name : "unknown error");
    res.status(500).json({ error: "Failed to process your request. Please try again later." });
  }
};
