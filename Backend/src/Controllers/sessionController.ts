// Controllers/sessionController.ts
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  chatMessagesCollection,
  chatSessionsCollection,
  initializeMongoChatStorage,
} from "../Services/initializeChatService";
import { ObjectId } from "mongodb"; // Import ObjectId for _id type
import { isAllowedMosdacHost } from "../ingestion/mosdacUrlPolicy";

const HISTORY_RESPONSE_LIMIT = 100;
const HISTORY_MESSAGE_CHAR_LIMIT = 16_000;

type StoredMessage = {
  type?: unknown;
  data?: { content?: unknown };
};
type AppendedMessageDocument = {
  _id: ObjectId;
  message?: unknown;
  createdAt?: Date;
};

type HistoryCitation = {
  id: string;
  title: string;
  source: string;
  page?: number;
  section?: string;
  url?: string;
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part: unknown) => {
    if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
      return [part.text];
    }
    return [];
  }).join(" ");
}

/** Recover citations from the legacy rendered footer without changing stored history. */
function restoreCitationFooter(text: string): { content: string; citations: HistoryCitation[] } {
  const footerStart = text.lastIndexOf("\n\nSources:\n");
  if (footerStart < 0) return { content: text, citations: [] };

  const lines = text.slice(footerStart + "\n\nSources:\n".length).split("\n");
  const citations: HistoryCitation[] = [];
  const seenIds = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\[(S\d+)\]\s+(.+?)\s+—\s+(.+)$/u);
    if (!match || seenIds.has(match[1]!)) return { content: text, citations: [] };
    seenIds.add(match[1]!);

    const label = match[2]!;
    const link = label.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/u);
    const location = match[3]!;
    const sectionDelimiter = location.lastIndexOf(", section ");
    const section = sectionDelimiter >= 0
      ? location.slice(sectionDelimiter + ", section ".length).trim()
      : undefined;
    const pageMatch = location.match(/,\s*page\s+(\d+)(?=,|$)/u);
    const sourceEnd = Math.min(
      pageMatch?.index ?? location.length,
      sectionDelimiter >= 0 ? sectionDelimiter : location.length,
    );
    const source = location.slice(0, sourceEnd).trim();
    if (!source) return { content: text, citations: [] };

    let url: string | undefined;
    if (link) {
      try {
        const parsedUrl = new URL(link[2]!);
        if (parsedUrl.protocol === "https:" && isAllowedMosdacHost(parsedUrl.hostname)) {
          url = parsedUrl.toString();
        }
      } catch {
        // Keep an unparseable/unapproved link as plain source text only.
      }
    }
    citations.push({
      id: match[1]!,
      title: link?.[1] ?? label,
      source,
      ...(pageMatch ? { page: Number(pageMatch[1]) } : {}),
      ...(section ? { section } : {}),
      ...(url ? { url } : {}),
    });
  }

  return citations.length
    ? { content: text.slice(0, footerStart), citations }
    : { content: text, citations: [] };
}

export const createSession = async (req: Request, res: Response) => {
  try {
    await initializeMongoChatStorage();
    if (!chatSessionsCollection || !req.authUser) {
      res.status(503).json({ error: "Conversation storage is unavailable." });
      return;
    }
    const newSessionId = randomUUID();
    const now = new Date();
    await chatSessionsCollection.insertOne({
      sessionId: newSessionId,
      ownerId: req.authUser.userId,
      title: "New chat",
      titleStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // Send the new session ID back to the client
    res.status(201).json({
      sessionId: newSessionId,
      message: "New chat session created successfully.",
    });
  } catch (error) {
    console.error("Session creation failed:", error instanceof Error ? error.name : "unknown error");
    res.status(500).json({
      error: "Failed to create a new session. Please try again later.",
    });
  }
};

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export const listConversations = async (req: Request, res: Response) => {
  try {
    await initializeMongoChatStorage();
    if (!chatSessionsCollection || !req.authUser) {
      res.status(503).json({ error: "Conversation storage is unavailable." });
      return;
    }
    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const filter: Record<string, unknown> = { ownerId: req.authUser.userId };
    if (search) filter.title = { $regex: escapeRegularExpression(search), $options: "i" };
    const conversations = await chatSessionsCollection
      .find(filter, { projection: { sessionId: 1, title: 1, createdAt: 1, updatedAt: 1 } })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(100)
      .toArray();
    res.status(200).json({ conversations: conversations.map((conversation) => ({
      sessionId: conversation.sessionId,
      title: typeof conversation.title === "string" ? conversation.title : "New chat",
      createdAt: conversation.createdAt instanceof Date ? conversation.createdAt.toISOString() : null,
      updatedAt: conversation.updatedAt instanceof Date ? conversation.updatedAt.toISOString() : null,
    })) });
  } catch (error) {
    console.error("Conversation list failed:", error instanceof Error ? error.name : "unknown error");
    res.status(500).json({ error: "Could not load chat history." });
  }
};

export const getChatHistory = async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(sessionId)) {
    res.status(400).json({ error: "A valid session ID is required." });
    return;
  }

  try {
    await initializeMongoChatStorage();
    if (!chatSessionsCollection || !chatMessagesCollection || !req.authUser) {
      console.error("MongoDB chat sessions collection is not initialized.");
      throw new Error("Chat sessions collection is not initialized.");
    }

    const [sessionDocument, appendedDocuments] = await Promise.all([
      chatSessionsCollection.findOne(
        { sessionId, ownerId: req.authUser.userId },
        { projection: { messages: { $slice: -HISTORY_RESPONSE_LIMIT } } },
      ),
      chatMessagesCollection
        .find({ sessionId }, { projection: { message: 1, createdAt: 1 } })
        .sort({ createdAt: -1, _id: -1 })
        .limit(HISTORY_RESPONSE_LIMIT)
        .toArray(),
    ]);

    if (!sessionDocument) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const formattedHistory: Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      timestamp: string;
      citations?: HistoryCitation[];
    }> = [];

    if (sessionDocument && Array.isArray(sessionDocument.messages)) {
      const objectId = sessionDocument._id;
      const sessionTimestamp = objectId instanceof ObjectId
        ? objectId.getTimestamp().toISOString()
        : new Date(0).toISOString();
      const firstIndex = Math.max(0, sessionDocument.messages.length - HISTORY_RESPONSE_LIMIT);

      formattedHistory.push(...sessionDocument.messages
        .slice(-HISTORY_RESPONSE_LIMIT)
        .flatMap((rawMessage: unknown, offset: number) => {
          if (typeof rawMessage !== "object" || rawMessage === null) return [];
          const message = rawMessage as StoredMessage;
          const role = message.type === "human"
            ? "user"
            : message.type === "ai"
              ? "assistant"
              : null;
          const content = messageText(message.data?.content)
            .slice(0, HISTORY_MESSAGE_CHAR_LIMIT);
          if (!role || !content) return [];
          const restored = role === "assistant"
            ? restoreCitationFooter(content)
            : { content, citations: [] as HistoryCitation[] };
          return [{
            id: `${String(objectId)}-${firstIndex + offset}`,
            role: role as "user" | "assistant",
            content: restored.content,
            ...(restored.citations.length ? { citations: restored.citations } : {}),
            // The current storage format has no per-message timestamps.
            timestamp: sessionTimestamp,
          }];
        }));
    }

    for (const rawDocument of appendedDocuments.reverse()) {
      const document = rawDocument as AppendedMessageDocument;
      if (typeof document.message !== "object" || document.message === null) continue;
      const message = document.message as StoredMessage;
      const role = message.type === "human"
        ? "user"
        : message.type === "ai"
          ? "assistant"
          : null;
      const content = messageText(message.data?.content).slice(0, HISTORY_MESSAGE_CHAR_LIMIT);
      if (!role || !content) continue;
      const restored = role === "assistant"
        ? restoreCitationFooter(content)
        : { content, citations: [] as HistoryCitation[] };
      formattedHistory.push({
        id: String(document._id),
        role,
        content: restored.content,
        timestamp: document.createdAt instanceof Date
          ? document.createdAt.toISOString()
          : document._id.getTimestamp().toISOString(),
        ...(restored.citations.length ? { citations: restored.citations } : {}),
      });
    }
    const recentHistory = formattedHistory.slice(-HISTORY_RESPONSE_LIMIT);

    if (recentHistory.length === 0) {
      console.log("No messages found for the requested session.");
    }

    res.status(200).json({
      sessionId: sessionId,
      history: recentHistory,
      message: "Chat history retrieved successfully.",
    });
  } catch (error) {
    console.error("Chat history retrieval failed:", error instanceof Error ? error.name : "unknown error");
    res.status(500).json({
      error: "Failed to retrieve chat history. Please try again later.",
    });
  }
};
