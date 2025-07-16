"use client";

import { useState, useRef, useEffect, useCallback, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  User,
  Loader2,
  PlusCircle,
  Image as ImageIcon,
  XCircle,
  Languages,
  Mic,
  StopCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Image from "next/image";
import { Textarea } from "@/components/ui/textarea";

import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { AudioModeModal } from "@/components/AudioModeModal";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    SpeechRecognitionEvent: any;
  }
}

type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: string;
  sources?: string[];
  isStreaming?: boolean;
  imageData?: string;
  audioData?: string;
};

const BASE_URL = "http://localhost:5000";

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "hi", name: "हिन्दी" },
  { code: "hi-en", name: "Hinglish" },
  { code: "de", name: "Deutsch" },
];

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isAudioModalOpen, setIsAudioModalOpen] = useState(false);
  const [audioState, setAudioState] = useState<
    "idle" | "listening" | "processing" | "speaking"
  >("idle");
  const [selectedImage, setSelectedImage] = useState<{
    base64: string;
    previewUrl: string;
  } | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // In chat-interface.tsx

  // In chat-interface.tsx

  // In chat-interface.tsx

  // In ChatInterface.tsx

  const handleAudioMessage = async (transcript: string) => {
    console.log(
      `[ChatInterface] Handling finalized transcript: "${transcript}"`
    );
    if (!transcript.trim()) {
      console.log("[ChatInterface] Transcript was empty, re-listening...");
      startModalListening(); // If user doesn't speak, just start listening again
      return;
    }

    setAudioState("processing");
    console.log("[ChatInterface] State changed to -> processing");

    const userMessage: Message = {
      id: Date.now().toString(),
      content: transcript,
      role: "user",
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      console.log("[ChatInterface] Sending audio transcript to backend...");
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: transcript,
          sessionId: sessionId,
          isAudioMode: true,
          targetLanguage: selectedLanguage,
        }),
      });

      if (!response.ok) throw new Error("API call failed");

      const data = await response.json();
      const aiMessage: Message = data.aiMessage;

      console.log("[ChatInterface] Received response from backend.", data);
      setMessages((prev) => [...prev, aiMessage]);

      if (aiMessage && aiMessage.audioData && aiMessage.audioData.length > 50) {
        setAudioState("speaking");
        console.log("[ChatInterface] State changed to -> speaking");

        const audioPlayer = new Audio(
          `data:audio/mp3;base64,${aiMessage.audioData}`
        );

        // --- THIS IS THE KEY CHANGE ---
        // When the AI finishes speaking, start the next listening cycle automatically.
        audioPlayer.onended = () => {
          console.log(
            "[ChatInterface] Audio playback finished. Looping back to listening state."
          );
          startModalListening();
        };

        audioPlayer.onerror = (e) => {
          console.error("[ChatInterface] Error during audio playback:", e);
          // On error, we should probably close to prevent getting stuck in a loop
          closeAudioModal();
        };

        console.log("[ChatInterface] Attempting to play audio...");
        audioPlayer.play().catch((error) => {
          console.error(
            "[ChatInterface] Audio autoplay was prevented by the browser:",
            error
          );
          closeAudioModal();
        });
      } else {
        // If there's no audio data, immediately loop back to listening for the user's next turn.
        console.log(
          "[ChatInterface] No audio data in response, looping back to listening."
        );
        startModalListening();
      }
    } catch (error) {
      console.error(
        "[ChatInterface] Error during audio message handling:",
        error
      );
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: "Sorry, an error occurred. Please try again.",
        role: "assistant",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      // Close the modal on a critical error
      closeAudioModal();
    }
  };

  const {
    isListening: isModalListening,
    transcript: modalTranscript,
    startListening: startModalListening,
    stopListening: stopModalListening,
  } = useAudioRecorder(handleAudioMessage);
  useEffect(() => {
    if (isModalListening) setAudioState("listening");
  }, [isModalListening]);
  const openAudioModal = () => {
    setIsAudioModalOpen(true);
    startModalListening();
  };
  const closeAudioModal = () => {
    stopModalListening();
    setIsAudioModalOpen(false);
    setAudioState("idle");
  };

  const scrollToBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [inputValue, selectedImage]);

  const fetchChatHistory = useCallback(async (currentSessionId: string) => {
    try {
      const response = await fetch(
        `${BASE_URL}/api/session/history/${currentSessionId}`
      );
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.history?.length)
        setMessages(
          data.history.filter(
            (msg: any) =>
              msg && msg.id && msg.content && msg.role && msg.timestamp
          )
        );
      else setMessages([]);
    } catch (error) {
      console.error("Error fetching chat history:", error);
    }
  }, []);

  const establishSession = useCallback(async () => {
    setIsLoadingSession(true);
    let currentSessionId = localStorage.getItem("chatSessionId");
    if (currentSessionId) {
      setSessionId(currentSessionId);
      await fetchChatHistory(currentSessionId);
    } else {
      try {
        const response = await fetch(`${BASE_URL}/api/session`);
        const data = await response.json();
        currentSessionId = data.sessionId;
        localStorage.setItem("chatSessionId", currentSessionId!);
        setSessionId(currentSessionId);
      } catch (error) {
        console.error("Error establishing new session:", error);
      }
    }
    setIsLoadingSession(false);
  }, [fetchChatHistory]);

  useEffect(() => {
    establishSession();
  }, [establishSession]);
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = useCallback(
    async (messageContentOverride?: string) => {
      const messageToSend =
        messageContentOverride !== undefined
          ? messageContentOverride
          : inputValue;
      if (!messageToSend.trim() && !selectedImage) return;
      if (!sessionId) return;
      const newUserMessage: Message = {
        id: Date.now().toString(),
        content: messageToSend,
        role: "user",
        timestamp: new Date().toISOString(),
        imageData: selectedImage?.base64,
      };
      setMessages((prev) => [...prev, newUserMessage]);
      setInputValue("");
      clearSelectedImage();
      setIsTyping(true);
      try {
        const response = await fetch(`${BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: messageToSend,
            sessionId,
            imageData: newUserMessage.imageData,
            targetLanguage: selectedLanguage,
          }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.error || `HTTP error! status: ${response.status}`
          );
        }
        const data = await response.json();
        const aiMessage: Message = data.aiMessage;
        setMessages((prev) => [...prev, aiMessage]);
      } catch (error: any) {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: `Oops! Something went wrong: ${
            error.message || "Unknown error"
          }.`,
          role: "assistant",
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsTyping(false);
      }
    },
    [sessionId, selectedImage, inputValue, selectedLanguage]
  );

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        const interimTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join("");
        setInputValue(interimTranscript);
      };
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (event: any) => {
        setIsListening(false);
        console.error("[STT onerror]:", event.error);
      };
      recognitionRef.current = recognition;
      return () => {
        if (recognitionRef.current) recognitionRef.current.stop();
      };
    }
  }, []);

  const toggleListening = () => {
    if (recognitionRef.current) {
      if (isListening) recognitionRef.current.stop();
      else {
        setInputValue("");
        recognitionRef.current.start();
      }
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () =>
      setSelectedImage({
        base64: reader.result as string,
        previewUrl: URL.createObjectURL(file),
      });
    reader.readAsDataURL(file);
  };

  const handleImageButtonClick = () => {
    if (isInputAndSendDisabled || isListening) return;
    fileInputRef.current?.click();
  };

  const clearSelectedImage = () => {
    if (selectedImage?.previewUrl)
      URL.revokeObjectURL(selectedImage.previewUrl);
    setSelectedImage(null);
  };

  const handleNewChat = () => {
    localStorage.removeItem("chatSessionId");
    setSessionId(null);
    setMessages([]);
    setInputValue("");
    setIsTyping(false);
    clearSelectedImage();
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
    setSelectedLanguage("en");
    establishSession();
  };

  const StreamingDots = () => (
    <motion.div className="flex space-x-1">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 bg-blue-400 rounded-full"
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </motion.div>
  );

  const showWelcomeMessage = messages.length === 0 && !isLoadingSession;
  const isInputAndSendDisabled =
    isTyping || isLoadingSession || !sessionId || isListening;

  return (
    <div className="flex-1 flex flex-col bg-slate-900/40 min-h-0 relative pt-20">
      {/* --- BUTTONS RESTORED --- */}
      <div className="fixed top-4 right-4 z-50 flex space-x-3">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="relative"
        >
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            disabled={isInputAndSendDisabled}
            className="appearance-none bg-slate-700 hover:bg-slate-600 text-white rounded-full pl-4 pr-10 py-3 shadow-lg cursor-pointer text-sm md:text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 0.75rem center",
              backgroundSize: "1.5em 1.5em",
            }}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-white">
            <Languages className="w-5 h-5" />
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Button
            onClick={handleNewChat}
            disabled={isLoadingSession}
            className="bg-purple-600 hover:bg-purple-700 text-white rounded-full p-3 shadow-lg flex items-center justify-center"
            title="Start New Chat"
          >
            <PlusCircle className="w-5 h-5" />
            <span className="ml-2 hidden md:inline">New Chat</span>
          </Button>
        </motion.div>
      </div>

      <div
        className="flex-1 overflow-y-auto p-3 md:p-6 custom-scrollbar"
        aria-live="polite"
      >
        {showWelcomeMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center text-white mb-8 mt-auto flex flex-col justify-center items-center h-full"
          >
            <h1 className="text-3xl md:text-4xl font-bold mb-2">
              Hey, Ready to dive in?
            </h1>
            <p className="text-lg md:text-xl text-slate-400">
              Ask about satellite data, missions, and more.
            </p>
          </motion.div>
        )}
        <div
          className={`max-w-4xl mx-auto ${
            showWelcomeMessage ? "hidden" : "space-y-3 md:space-y-4"
          }`}
        >
          <AnimatePresence>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <Card
                  className={`max-w-[85%] md:max-w-[80%] p-3 md:p-4 ${
                    message.role === "user"
                      ? "bg-blue-700/20 border-blue-600/30"
                      : "bg-slate-800/50 border-slate-600/30"
                  } text-white`}
                >
                  <div className="flex items-start space-x-2 md:space-x-3">
                    <div
                      className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.role === "user" ? "bg-blue-500" : "bg-white"
                      }`}
                    >
                      {message.role === "user" ? (
                        <User className="w-3 h-3 md:w-4 md:h-4 text-white" />
                      ) : (
                        <Image
                          height={100}
                          width={100}
                          src={"/logo.png"}
                          alt="logo"
                          className="w-full"
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {message.role === "user" && message.imageData && (
                        <div className="mb-3 rounded-lg overflow-hidden border border-slate-600">
                          <img
                            src={message.imageData}
                            alt="Uploaded by user"
                            className="max-w-full h-auto rounded-md"
                            style={{ maxHeight: "200px", objectFit: "contain" }}
                          />
                        </div>
                      )}
                      <div className="leading-relaxed text-sm md:text-base break-words markdown-content prose prose-invert prose-sm md:prose-base max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                      <div
                        className={`text-xs mt-1 ${
                          message.role === "user"
                            ? "text-blue-200"
                            : "text-slate-400"
                        }`}
                      >
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <Card className="max-w-[85%] md:max-w-2xl p-3 md:p-4 bg-slate-800/50 border-slate-600/30">
                <div className="flex items-center space-x-2 md:space-x-3">
                  <div
                    className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-white`}
                  >
                    <Image
                      height={100}
                      width={100}
                      src={"/logo.png"}
                      alt="logo"
                      className="w-full"
                    />
                  </div>
                  <StreamingDots />
                </div>
              </Card>
            </motion.div>
          )}
          {isLoadingSession && messages.length === 0 && (
            <div className="flex justify-center items-center text-slate-400 py-4">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Initializing
              chat session...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <motion.div
        layout
        className="p-3 md:p-6 border-t border-slate-700/50 bg-slate-900/80 backdrop-blur-md"
      >
        <div className="max-w-4xl mx-auto">
          {selectedImage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="relative mb-3 p-2 border border-slate-600 rounded-lg bg-slate-800/50 flex items-center justify-center"
            >
              <img
                src={selectedImage.previewUrl}
                alt="Preview"
                className="max-w-full h-auto rounded-md"
                style={{ maxHeight: "150px", objectFit: "contain" }}
              />
              <Button
                size="sm"
                variant="ghost"
                className="absolute top-1 right-1 text-red-400 hover:text-red-500 p-1"
                onClick={clearSelectedImage}
                title="Remove image"
              >
                <XCircle className="w-4 h-4" />
              </Button>
            </motion.div>
          )}
          <div className="flex items-end space-x-2 md:space-x-4">
            <div className="flex-1 relative">
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <Button
                size="sm"
                variant="ghost"
                className={`absolute left-1 md:left-2 bottom-1 p-1 md:p-2 ${
                  isInputAndSendDisabled
                    ? "text-slate-600 cursor-not-allowed"
                    : "text-slate-400"
                }`}
                onClick={handleImageButtonClick}
                disabled={isInputAndSendDisabled}
                title="Upload Image"
              >
                <ImageIcon className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
              <Textarea
                ref={textareaRef}
                placeholder={
                  isListening ? "Listening..." : "Ask about satellite data..."
                }
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                rows={1}
                className="pl-10 pr-10 md:pl-12 md:pr-12 bg-slate-800/50 border-slate-600 text-white"
                disabled={isInputAndSendDisabled}
              />
              <Button
                size="sm"
                variant="ghost"
                className={`absolute right-1 md:right-2 bottom-1 p-1 md:p-2 ${
                  isListening ? "text-red-500 animate-pulse" : "text-slate-400"
                }`}
                onClick={toggleListening}
                disabled={isLoadingSession || !sessionId || isTyping}
                title={isListening ? "Stop Listening" : "Start Voice Input"}
              >
                {isListening ? (
                  <StopCircle className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </Button>
            </div>
            <Button
              onClick={openAudioModal}
              disabled={isInputAndSendDisabled}
              className="bg-green-600 hover:bg-green-700 text-white h-full px-3 md:px-4"
              title="Start Voice Chat"
            >
              <span>Audio Mode</span>
              <Mic className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => handleSendMessage()}
              disabled={
                (!inputValue.trim() && !selectedImage) || isInputAndSendDisabled
              }
              className="bg-blue-600 hover:bg-blue-700 text-white h-full px-3 md:px-4"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </motion.div>

      <AudioModeModal
        isOpen={isAudioModalOpen}
        onClose={closeAudioModal}
        audioState={audioState}
        transcript={modalTranscript}
      />
    </div>
  );
}
