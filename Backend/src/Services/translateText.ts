// src/Services/translateText.ts

import { PromptTemplate } from "@langchain/core/prompts";
import { chatLLM } from "./initializeChatService"; // Assuming chatLLM is exported from here
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

/**
 * Translates text to English using the Gemini API via LangChain.
 * @param text The text to translate.
 * @param sourceLang The source language code (e.g., 'es', 'fr', 'hi').
 * @returns A Promise that resolves to the translated English text.
 */
export async function translateToEnglish(
  text: string,
  sourceLang: string
): Promise<string> {
  if (sourceLang === "en") {
    return text; // No translation needed if already English
  }

  if (!chatLLM) {
    console.error(
      "[LLM Translation] chatLLM is not initialized for English translation."
    );
    return text; // Fallback to original text if LLM is not ready
  }

  const promptTemplate = PromptTemplate.fromTemplate(
    `Translate the following text from ${sourceLang} to English. Provide only the translated text, without any additional comments or formatting:\n\n{text_to_translate}`
  );

  const chain = RunnableSequence.from([
    promptTemplate,
    chatLLM,
    new StringOutputParser(),
  ]);

  try {
    console.log(
      `[LLM Translation] Requesting translation to English for: "${text.substring(
        0,
        50
      )}..."`
    );
    const translatedText = await chain.invoke({ text_to_translate: text });
    console.log(
      `[LLM Translation] Translated to English: "${translatedText.substring(
        0,
        50
      )}..."`
    );
    return translatedText.trim(); // Trim whitespace from LLM output
  } catch (error) {
    console.error(
      "[LLM Translation] Error during translation to English:",
      error
    );
    return text; // Fallback to original text on error
  }
}

/**
 * Translates text to a target language using the Gemini API via LangChain.
 * @param text The text to translate (assumed to be English).
 * @param targetLang The target language code (e.g., 'es', 'fr', 'hi').
 * @returns A Promise that resolves to the translated text in the target language.
 */
export async function translateToTargetLanguage(
  text: string,
  targetLang: string
): Promise<string> {
  if (targetLang === "en") {
    return text; // No translation needed if target is English
  }

  if (!chatLLM) {
    console.error(
      `[LLM Translation] chatLLM is not initialized for ${targetLang} translation.`
    );
    return text; // Fallback to original text if LLM is not ready
  }

  let promptInstruction: string;
  if (targetLang === "hi-en") {
    // Specific prompt for Hinglish
    promptInstruction = `Translate the following English text into Hinglish (a natural mix of Hindi and English, using latin script for Hindi words and English words both). Maintain the original meaning and tone. Provide only the translated text, without any additional comments or formatting:\n\n{text_to_translate}`;
  } else {
    // General prompt for other languages
    promptInstruction = `Translate the following English text to ${targetLang}. Provide only the translated text, without any additional comments or formatting:\n\n{text_to_translate}`;
  }

  const promptTemplate = PromptTemplate.fromTemplate(promptInstruction);

  const chain = RunnableSequence.from([
    promptTemplate,
    chatLLM,
    new StringOutputParser(),
  ]);

  try {
    console.log(
      `[LLM Translation] Requesting translation to ${targetLang} for: "${text.substring(
        0,
        50
      )}..."`
    );
    const translatedText = await chain.invoke({ text_to_translate: text });
    console.log(
      `[LLM Translation] Translated to ${targetLang}: "${translatedText.substring(
        0,
        50
      )}..."`
    );
    return translatedText.trim(); // Trim whitespace from LLM output
  } catch (error) {
    console.error(
      `[LLM Translation] Error during translation to ${targetLang}:`,
      error
    );
    return text; // Fallback to original text on error
  }
}