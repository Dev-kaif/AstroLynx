import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { env } from "../config/env";
import { GEMINI_API_KEY } from "../utils/Config";

let titleModel: ChatGoogleGenerativeAI | null = null;

export function fallbackConversationTitle(question: string): string {
  const clean = question
    .replace(/https?:\/\/\S+/giu, "link")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!clean) return "New chat";
  if (clean.length <= 56) return clean;
  const clipped = clean.slice(0, 56);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > 28 ? boundary : 56).trimEnd()}…`;
}

export async function generateConversationTitle(question: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("Gemini API key is not configured.");
  titleModel ??= new ChatGoogleGenerativeAI({
    apiKey: GEMINI_API_KEY,
    model: env.GEMINI_TITLE_MODEL,
    temperature: 0.1,
    maxOutputTokens: 40,
  });
  const response = await titleModel.invoke([
    new SystemMessage("Create a short title for a chat from the user's first message. Return only a title of 2 to 6 words, no quotes, no punctuation at the end. Preserve the message language. Do not answer the question."),
    new HumanMessage(question.slice(0, 1000)),
  ]);
  const responseContent = typeof response.content === "string"
    ? response.content
    : response.content.flatMap((part) =>
        typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
          ? [part.text]
          : []
      ).join(" ");
  const title = responseContent
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/^["'“”‘’`\s]+|["'“”‘’`\s]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
  if (!title) throw new Error("Title model returned an empty title.");
  return title;
}

