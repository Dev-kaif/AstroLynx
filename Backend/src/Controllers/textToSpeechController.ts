// src/Controllers/textToSpeechController.ts
import { Request, Response } from "express";
import axios from "axios"; // NEW: Import axios
import { SARVAM_AI_API_KEY } from "../utils/Config";

export const textToSpeechController = async (req: Request, res: Response) => {
  const {
    text,
    target_language_code = "en-IN",
    speaker = "anushka",
  } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required for TTS." });
  }

  if (!SARVAM_AI_API_KEY || SARVAM_AI_API_KEY === "YOUR_SARVAM_AI_API_KEY") {
    console.error("Sarvam AI API key is not configured.");
    return res
      .status(500)
      .json({ error: "Text-to-Speech service is not configured." });
  }

  try {
    const sarvamApiResponse = await axios.post(
      "https://api.sarvam.ai/text-to-speech",
      {
        text: text,
        target_language_code: target_language_code,
        speaker: speaker,
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
      console.error("Sarvam AI TTS API did not return audio data.");
      return res
        .status(500)
        .json({ error: "No audio data received from TTS service." });
    }

    res.json({ audioData: base64Audio });
  } catch (error: any) {
    console.error("Error in textToSpeechController:", error);
    if (axios.isAxiosError(error) && error.response) {
      console.error("Sarvam AI TTS API error response:", error.response.data);
      return res.status(error.response.status).json({
        error:
          error.response.data.message ||
          "Failed to convert text to speech via Sarvam AI.",
      });
    } else {
      res
        .status(500)
        .json({ error: error.message || "Internal server error during TTS." });
    }
  }
};
