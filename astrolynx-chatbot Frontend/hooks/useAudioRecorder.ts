// src/hooks/useAudioRecorder.tsx
import { useState, useRef, useEffect, useCallback } from "react";

// Global types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface AudioRecorderResult {
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
}

export const useAudioRecorder = (
  onTranscriptFinalized: (transcript: string) => void
): AudioRecorderResult => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<any>(null);

  const onTranscriptFinalizedRef = useRef(onTranscriptFinalized);
  useEffect(() => {
    onTranscriptFinalizedRef.current = onTranscriptFinalized;
  }, [onTranscriptFinalized]);

  useEffect(() => {
    console.log("[AudioRecorder] Setting up SpeechRecognition...");
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("[AudioRecorder] Speech Recognition API is not supported.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      console.log("[AudioRecorder] onstart: Listening has started.");
      setIsListening(true);
      setTranscript("");
    };

    recognition.onresult = (event: any) => {
      const currentTranscript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join("");
      console.log(
        "[AudioRecorder] onresult: Interim transcript ->",
        `"${currentTranscript}"`
      );
      setTranscript(currentTranscript);
    };

    recognition.onend = () => {
      console.log("[AudioRecorder] onend: Listening has stopped.");
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error(
        "[AudioRecorder] onerror: Speech recognition error ->",
        event.error
      );
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        console.log("[AudioRecorder] Cleanup: Stopping recognition instance.");
        recognitionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!isListening && transcript.trim()) {
      console.log(
        `[AudioRecorder] Finalizing transcript: "${transcript.trim()}"`
      );
      onTranscriptFinalizedRef.current(transcript.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      console.log("[AudioRecorder] startListening() called.");
      setTranscript("");
      recognitionRef.current.start();
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      console.log("[AudioRecorder] stopListening() called.");
      recognitionRef.current.stop();
    }
  }, [isListening]);

  return { isListening, transcript, startListening, stopListening };
};
