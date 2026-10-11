// Services/Memory.ts
import { BaseListChatMessageHistory } from "@langchain/core/chat_history";
import {
  BaseMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
import { BufferWindowMemory } from "langchain/memory";
import { chatMessagesCollection, chatSessionsCollection } from "./initializeChatService";

import { chatLLM } from "./initializeChatService";
import { Document } from "@langchain/core/documents";
import { Collection } from "mongodb";
import { isAllowedMosdacHost } from "../ingestion/mosdacUrlPolicy";
import { logStageTiming, startTimer } from "../utils/performanceLog";

const CONTEXT_MAX_TOKENS = 4000;
const MEMORY_WINDOW_SIZE = 10;
const HISTORY_MAX_CHARS = 12_000;
const HISTORY_READ_LIMIT = 200;
type StoredChatMessage = ReturnType<typeof mapChatMessagesToStoredMessages>[number];
type SessionHistoryDocument = { sessionId: string; messages: StoredChatMessage[] };
type SessionMessageDocument = { sessionId: string; message: StoredChatMessage; createdAt: Date };

/** Read old embedded history and append new messages in a scalable collection. */
class BoundedMongoChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ["astrolynx", "chat_history", "mongodb"];

  constructor(
    private readonly legacyCollection: Collection<SessionHistoryDocument>,
    private readonly messagesCollection: Collection<SessionMessageDocument>,
    private readonly sessionId: string,
  ) {
    super();
  }

  async getMessages(): Promise<BaseMessage[]> {
    const [legacyDocument, recentMessageDocuments] = await Promise.all([
      this.legacyCollection.findOne(
        { sessionId: this.sessionId },
        { projection: { messages: { $slice: -HISTORY_READ_LIMIT } } },
      ),
      this.messagesCollection
        .find({ sessionId: this.sessionId }, { projection: { message: 1 } })
        .sort({ createdAt: -1, _id: -1 })
        .limit(HISTORY_READ_LIMIT)
        .toArray(),
    ]);
    const legacyMessages = Array.isArray(legacyDocument?.messages)
      ? legacyDocument.messages as StoredChatMessage[]
      : [];
    const appendedMessages = recentMessageDocuments
      .reverse()
      .map((document) => document.message);
    return mapStoredMessagesToChatMessages(
      [...legacyMessages, ...appendedMessages].slice(-HISTORY_READ_LIMIT),
    );
  }

  async addMessage(message: BaseMessage): Promise<void> {
    const [storedMessage] = mapChatMessagesToStoredMessages([message]);
    if (!storedMessage) return;
    await this.messagesCollection.insertOne({
      sessionId: this.sessionId,
      message: storedMessage,
      createdAt: new Date(),
    });
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.legacyCollection.deleteOne({ sessionId: this.sessionId }),
      this.messagesCollection.deleteMany({ sessionId: this.sessionId }),
    ]);
  }
}

export interface AgentState {
  question: string;
  chat_history: BaseMessage[];
  retrieved_docs: Document[];
  llm_response: string;
  context?: string;

  rewritten_queries?: string[];
  hypothetical_doc_query?: string;
  raw_pinecone_results?: Document[][];
  raw_lexical_results?: Document[][];
  rrf_ranked_docs?: Document[];

  imageData?: string;
  targetLanguage?: string;
  isAudioMode?: boolean; 
  audioData?: string;
  citations?: EvidenceCitation[];
}

export interface EvidenceCitation {
  id: string;
  title: string;
  source: string;
  page?: number;
  section?: string;
  url?: string;
}

export async function getSessionMemory(
  sessionId: string
): Promise<BufferWindowMemory> {
  if (!chatSessionsCollection || !chatMessagesCollection) {
    throw new Error("MongoDB chat sessions collection is not initialized.");
  }

  const chatHistory = new BoundedMongoChatMessageHistory(
    chatSessionsCollection as unknown as Collection<SessionHistoryDocument>,
    chatMessagesCollection as unknown as Collection<SessionMessageDocument>,
    sessionId,
  );

  const memory = new BufferWindowMemory({
    k: MEMORY_WINDOW_SIZE,
    returnMessages: true,
    memoryKey: "chat_history",
    inputKey: "question",
    chatHistory: chatHistory,
  });

  return memory;
}

/** Bound conversation-only context while retaining the newest complete turn suffix. */
export function boundChatHistory(messages: BaseMessage[]): BaseMessage[] {
  let remainingChars = HISTORY_MAX_CHARS;
  let start = messages.length;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index]!.content;
    const serializedContent = typeof content === "string" ? null : JSON.stringify(content);
    const contentSize = typeof content === "string"
      ? content.length
      : serializedContent?.length ?? 0;
    if (contentSize > remainingChars) break;
    remainingChars -= contentSize;
    start = index;
  }

  const bounded = messages.slice(start);
  // A clipped suffix beginning with an assistant answer loses its user-side
  // reference. Drop that answer; the prompt should receive complete turns.
  if (bounded[0]?.getType() === "ai") bounded.shift();
  return bounded;
}

export async function buildContext(
  state: AgentState
): Promise<Partial<AgentState>> {
  const startedAt = startTimer();
  const selectedDocs = (state.rrf_ranked_docs ?? [])
    .filter((document) => document.pageContent.trim().length > 20)
    .slice(0, 6);
  const citations: EvidenceCitation[] = selectedDocs.map((document, index) => {
    const metadata = document.metadata ?? {};
    const rawSource =
      metadata.source ?? metadata.file_path ?? metadata.filepath ?? metadata.url ?? "Unknown source";
    const source = String(rawSource);
    const title = String(metadata.title ?? metadata.documentTitle ?? source);
    const pageCandidate =
      metadata.pageNumber ?? metadata.page_number ?? metadata.page ?? metadata.loc?.pageNumber;
    const page = pageCandidate !== undefined && pageCandidate !== null && pageCandidate !== "" && Number.isInteger(Number(pageCandidate))
      ? Number(pageCandidate)
      : undefined;
    const sectionCandidate = metadata.section ?? metadata.sectionTitle;
    let url: string | undefined;
    try {
      const candidateUrl = new URL(source);
      if (candidateUrl.protocol === "https:" && isAllowedMosdacHost(candidateUrl.hostname)) {
        url = candidateUrl.toString();
      }
    } catch {
      // Local file paths and malformed/unapproved URLs remain plain citations.
    }

    return {
      id: `S${index + 1}`,
      title,
      source,
      page,
      section: sectionCandidate ? String(sectionCandidate) : undefined,
      url,
    };
  });

  const blocks = selectedDocs.map((document, index) => {
    const citation = citations[index]!;
    const location = [
      citation.source,
      citation.page !== undefined ? `page ${citation.page}` : undefined,
      citation.section,
    ].filter(Boolean).join(" | ");
    // Bound each passage to prevent one oversized chunk displacing all other
    // evidence. The source ID is shared by the answer citation and UI metadata.
    const passage = document.pageContent.trim().slice(0, 5000);
    return [
      `Evidence ${citation.id} (untrusted source data)`,
      `Title JSON: ${JSON.stringify(citation.title)}`,
      `Location JSON: ${JSON.stringify(location)}`,
      `Passage JSON: ${JSON.stringify(passage)}`,
      `End evidence ${citation.id}`,
    ].join("\n");
  });

  let context = blocks.join("\n\n");
  let includedCount = citations.length;
  if (context && chatLLM?.getNumTokens) {
    // Token count grows monotonically with this ranked prefix. Binary search
    // avoids re-tokenizing each shorter candidate when the context is full.
    let low = 0;
    let high = blocks.length;
    while (low < high) {
      const candidateCount = Math.ceil((low + high) / 2);
      const candidateContext = blocks.slice(0, candidateCount).join("\n\n");
      if ((await chatLLM.getNumTokens(candidateContext)) <= CONTEXT_MAX_TOKENS) {
        low = candidateCount;
      } else {
        high = candidateCount - 1;
      }
    }
    includedCount = low;
    context = blocks.slice(0, includedCount).join("\n\n");
  }
  const includedCitations = citations.slice(0, includedCount);
  if (!context) {
    context = "No relevant source passages were retrieved.";
  }

  logStageTiming("context_packing", startedAt, {
    candidateDocuments: state.rrf_ranked_docs?.length ?? 0,
    includedDocuments: includedCitations.length,
    contextCharacters: context.length,
  });

  return {
    context,
    retrieved_docs: selectedDocs.slice(0, includedCount),
    citations: includedCitations,
  };
}
