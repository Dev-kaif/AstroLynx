// src/Controllers/textToSpeechController.ts
// src/Controllers/textToSpeechController.ts

import { Request, Response } from "express";
import axios from "axios";
import { SARVAM_AI_API_KEY } from "../utils/Config";

const SARVAM_TTS_API_URL = "https://api.sarvam.ai/text-to-speech";
// Map frontend language codes to Sarvam AI specific locale codes
const SARVAM_LANGUAGE_MAP: { [key: string]: string } = {
  en: "en-IN",
  hi: "hi-IN",
  "hi-en": "hi-IN", // For Hinglish, we'll use Hindi-India for TTS as a fallback
  // Add other supported Indian languages if needed
};

/**
 * Core function to convert text to speech using the Sarvam AI Text-to-Speech API.
 * This function is directly callable by other services/nodes.
 * @param text The text to convert to speech.
 * @param targetLanguage The target language code (e.g., 'en', 'hi', 'hi-en').
 * @param speaker The speaker voice to be used.
 * @returns A Promise that resolves to the base64 encoded audio data, or null if an error occurs.
 */
export async function convertTextToSpeech(
  text: string,
  targetLanguage: string,
  speaker: string = "vidya" // Default speaker
): Promise<string | null> {
  if (!SARVAM_AI_API_KEY) {
    console.error("[TTS Core] Sarvam AI API key is not configured.");
    return null;
  }

  // Validate text length before sending to API
  if (text.length > 1500) {
    console.warn(
      `[TTS Core] Text exceeds 1500 character limit (${text.length}). Truncating for TTS.`
    );
    text = text.substring(0, 1500); // Truncate to avoid API error
  }

  // Get the Sarvam AI specific language code using the map
  const sarvamLangCode = SARVAM_LANGUAGE_MAP[targetLanguage] || "en-IN";

  console.log(
    `[TTS Core] Requesting TTS for text (first 50 chars): "${text.substring(
      0,
      50
    )}..."`
  );
  console.log(
    `[TTS Core] Target Language Code for Sarvam AI: "${sarvamLangCode}"`
  );
  console.log(`[TTS Core] Speaker: "${speaker}"`);
  console.log(`[TTS Core] Enable Preprocessing: true`);
  console.log(`[TTS Core] Output Audio Codec: mp3`);

  try {
    const sarvamApiResponse = await axios.post(
      SARVAM_TTS_API_URL,
      {
        text: text,
        target_language_code: sarvamLangCode,
        speaker: speaker,
        enable_preprocessing: true,
        output_audio_codec: "mp3",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": SARVAM_AI_API_KEY,
        },
        responseType: "json",
      }
    );

    const data = sarvamApiResponse.data;
    const base64Audio = data.audios?.[0];

    if (!base64Audio) {
      console.error("[TTS Core] Sarvam AI TTS API did not return audio data.");
      return null;
    }

    console.log("[TTS Core] Audio data generated successfully.");
    return base64Audio;
  } catch (error: any) {
    console.error("[TTS Core] Error converting text to speech:", error);
    if (axios.isAxiosError(error) && error.response) {
      console.error(
        "[TTS Core] Sarvam AI TTS API error response:",
        error.response.data
      );
    } else if (error.request) {
      console.error(
        "[TTS Core] Sarvam AI TTS API: No response received:",
        error.request
      );
    } else {
      console.error(
        "[TTS Core] Sarvam AI TTS API: Error setting up request:",
        error.message
      );
    }
    return null;
  }
}

/**
 * Express.js route handler for Text-to-Speech conversion.
 * This function wraps the core convertTextToSpeech logic for HTTP requests.
 */
export const textToSpeechController = async (req: Request, res: Response) => {
  const { text, target_language_code, speaker } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required for TTS." });
  }

  try {
    const audioData = await convertTextToSpeech(
      text,
      target_language_code,
      speaker
    );

    if (audioData) {
      res.json({ audioData: audioData });
    } else {
      res.status(500).json({ error: "Failed to convert text to speech." });
    }
  } catch (error: any) {
    console.error(
      "[TTS Route Handler] Error in textToSpeechController route:",
      error
    );
    // This catch block is mostly for unexpected errors, as convertTextToSpeech handles its own API errors
    res
      .status(500)
      .json({ error: error.message || "Internal server error during TTS." });
  }
};
