"use client";

import { useState, useRef, useEffect, useCallback, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  User,
  Bot,
  ExternalLink,
  Loader2,
  PlusCircle,
  Image as ImageIcon,
  XCircle,
  Languages, // Icon for language selection
  Mic, // Re-added Mic icon
  StopCircle, // Re-added StopCircle icon
} from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import Image from "next/image";
import { Textarea } from "./ui/textarea";

// Re-added global type declarations for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: any;
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
  // audioData?: string; // Still removed
};

const BASE_URL = "http://localhost:5000";

// Define supported languages for the dropdown
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "hi", name: "हिन्दी" },
  { code: "hi-en", name: "Hinglish" },
  { code: "de", name: "Deutsch" },
];

// Removed ListeningModal component definition

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  // Re-added isListening state
  const [isListening, setIsListening] = useState(false);
  // Removed recognitionError state as it was tied to the modal
  // const [recognitionError, setRecognitionError] = useState<string | null>(null);

  const [selectedImage, setSelectedImage] = useState<{
    base64: string;
    previewUrl: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Re-added recognitionRef
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Audio mode states remain removed
  // const [isAudioModeActive, setIsAudioModeActive] = useState(false);
  // const [isSpeakingAI, setIsSpeakingAI] = useState(false);
  // const [aiSpeakingText, setAiSpeakingText] = useState<string>("");
  // const audioPlayerInstanceRef = useRef<HTMLAudioElement | null>(null);
  // const [isContinuousAudioModalOpen, setIsContinuousAudioModalOpen] = useState(false);

  // State for selected language, default to English
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Auto-resize textarea logic
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [inputValue, selectedImage]);

  const fetchChatHistory = useCallback(async (currentSessionId: string) => {
    try {
      const response = await fetch(
        `${BASE_URL}/api/session/history/${currentSessionId}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log("Response from /api/session/history:", data);

      if (
        data.history &&
        Array.isArray(data.history) &&
        data.history.length > 0
      ) {
        const validHistory: Message[] = data.history.filter(
          (msg: any) =>
            msg &&
            typeof msg.id === "string" &&
            typeof msg.content === "string" &&
            (msg.role === "user" || msg.role === "assistant") &&
            typeof msg.timestamp === "string"
        );
        setMessages(validHistory);
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error("Error fetching chat history:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: "error-history",
          content:
            "Failed to load chat history. You can still send new messages.",
          role: "assistant",
          timestamp: new Date().toISOString(),
          sources: [],
        },
      ]);
    }
  }, []);

  const establishSession = useCallback(async () => {
    setIsLoadingSession(true);
    let currentSessionId = localStorage.getItem("chatSessionId");

    if (currentSessionId) {
      console.log(
        "Found existing session ID in localStorage:",
        currentSessionId
      );
      setSessionId(currentSessionId);
      await fetchChatHistory(currentSessionId);
    } else {
      setMessages([]);
      console.log(
        "No session ID found. Requesting new session from backend..."
      );

      try {
        const response = await fetch(`${BASE_URL}/api/session`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log("Response from /api/session (new session):", data);
        currentSessionId = data.sessionId;
        localStorage.setItem("chatSessionId", currentSessionId!);
        setSessionId(currentSessionId);
        console.log("New session ID established and saved:", currentSessionId);
      } catch (error) {
        console.error("Error establishing new session:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: "error-session-init",
            content:
              "Failed to start a new chat session. Please try refreshing the page.",
            role: "assistant",
            timestamp: new Date().toISOString(),
            sources: [],
          },
        ]);
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

  // Removed playSound function
  // Removed playAiResponse function
  // Removed toggleListeningForContinuousMode function

  // handleSendMessage now accepts an optional messageContent parameter (kept for flexibility)
  const handleSendMessage = useCallback(
    async (messageContentOverride?: string) => {
      // If an override is provided (from STT), use it; otherwise, use the current inputValue state.
      const messageToSend =
        messageContentOverride !== undefined
          ? messageContentOverride
          : inputValue;

      if (!messageToSend.trim() && !selectedImage) return;
      if (!sessionId) return;

      const userMessageContent = messageToSend;

      const newUserMessage: Message = {
        id: Date.now().toString(),
        content: userMessageContent,
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
            message: userMessageContent,
            sessionId: sessionId,
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
        console.log("Response from /api/chat (AI message):", data);

        const aiMessage: Message = data.aiMessage || data.reply;

        if (
          !aiMessage ||
          typeof aiMessage.id !== "string" ||
          typeof aiMessage.content !== "string" ||
          (aiMessage.role !== "user" && aiMessage.role !== "assistant") ||
          typeof aiMessage.timestamp !== "string"
        ) {
          console.error("Received invalid AI message format:", aiMessage);
          throw new Error("Invalid AI message format received from backend.");
        }

        setMessages((prev) => [...prev, aiMessage]);
      } catch (error: any) {
        console.error("Error sending message or receiving AI response:", error);
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: `Oops! Something went wrong: ${
            error.message || "Unknown error"
          }. Please try again.`,
          role: "assistant",
          timestamp: new Date().toISOString(),
          sources: [],
          isStreaming: false,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsTyping(false);
      }
    },
    [sessionId, selectedImage, inputValue, selectedLanguage]
  );

  // Re-added Speech-to-Text (STT) Logic useEffect for one-off STT
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // Listen for a single utterance
      recognition.interimResults = true; // Get interim results as the user speaks
      recognition.lang = "en-US"; // Set language for STT

      recognition.onstart = () => {
        setIsListening(true);
        // Removed setRecognitionError(null);
        console.log("[STT onstart]: Speech recognition started.");
      };

      recognition.onresult = (event: any) => {
        const interimTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join("");
        console.log("[STT onresult]: Interim transcript: ", interimTranscript);
        setInputValue(interimTranscript); // Update inputValue for display
      };

      recognition.onend = (event: any) => {
        // Ensure event parameter is present
        setIsListening(false);
        console.log("[STT onend]: Speech recognition ended.");

        const finalTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join("")
          .trim();

        console.log(
          "[STT onend]: Final transcript from event: ",
          finalTranscript
        );

        if (finalTranscript) {
          // For one-off STT, just populate the input field. User will manually send.
          setInputValue(finalTranscript);
        } else {
          console.warn("[STT onend]: No valid transcript detected.");
        }
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        console.error("[STT onerror]: Speech recognition error:", event.error);
        let errorMessage = "Speech recognition error.";
        if (event.error === "not-allowed") {
          errorMessage =
            "Microphone permission denied. Please allow access in your browser settings.";
        } else if (event.error === "no-speech") {
          errorMessage = "No speech detected. Please try again.";
        } else if (event.error === "audio-capture") {
          errorMessage = "No microphone found or audio capture failed.";
        }
        // Removed setRecognitionError(errorMessage);
        console.error(errorMessage);
      };

      recognitionRef.current = recognition;

      return () => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
          console.log("[STT Cleanup]: Recognition stopped.");
        }
      };
    } else {
      // Removed setRecognitionError("Speech recognition not supported in this browser.");
      console.warn("SpeechRecognition API not supported in this browser.");
    }
  }, []); // Dependencies are empty as it sets up event listeners once.

  // Re-added toggleListening function for the one-off mic button
  const toggleListening = () => {
    if (recognitionRef.current) {
      if (isListening) {
        recognitionRef.current.stop();
      } else {
        setInputValue(""); // Clear input before starting new recognition
        // Removed setRecognitionError(null);
        recognitionRef.current.start();
      }
    }
  };
  // --- End STT Logic ---

  // Image Upload Handlers
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        alert("Please upload an image file (e.g., JPG, PNG, GIF).");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert("Image file size exceeds 5MB limit.");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({
          base64: reader.result as string,
          previewUrl: URL.createObjectURL(file),
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageButtonClick = () => {
    // isInputAndSendDisabled now considers isListening
    if (isInputAndSendDisabled || isListening) {
      // Added isListening here
      console.log("Image upload disabled when other operations are active.");
      return;
    }
    fileInputRef.current?.click();
  };

  const clearSelectedImage = () => {
    if (selectedImage?.previewUrl) {
      URL.revokeObjectURL(selectedImage.previewUrl);
    }
    setSelectedImage(null);
  };

  const handleNewChat = () => {
    localStorage.removeItem("chatSessionId");
    setSessionId(null);
    setMessages([]);
    setInputValue("");
    setIsTyping(false);
    clearSelectedImage();
    // Reset STT states and stop recognition on new chat
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
    // Removed setRecognitionError(null);
    setSelectedLanguage("en");
    establishSession();
  };

  const StreamingDots = () => (
    <motion.div
      className="flex space-x-1"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 bg-blue-400 rounded-full"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 1,
            repeat: Number.POSITIVE_INFINITY,
            delay: i * 0.2,
          }}
        />
      ))}
    </motion.div>
  );

  const showWelcomeMessage = messages.length === 0 && !isLoadingSession;

  // Determine if Textarea, Send button, and Image button should be disabled
  // Now includes isListening
  const isInputAndSendDisabled =
    isTyping || isLoadingSession || !sessionId || isListening;

  return (
    <div className="flex-1 flex flex-col bg-slate-900/40  min-h-0 relative pt-20">
      {/* Floating Buttons Container */}
      <div className="fixed top-4 right-4 z-50 flex space-x-3">
        {/* Language Selector */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="relative"
        >
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            disabled={isLoadingSession || isTyping || isListening} // Disabled during active operations
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
            <Languages className="w-5 h-5" /> {/* Language icon */}
          </div>
        </motion.div>

        {/* New Chat Button */}
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

      {/* Main Chat Messages Area */}
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
                      ? "bg-blue-700/20 border-blue-600/30 text-white"
                      : "bg-slate-800/50 border-slate-600/30 text-white"
                  }`}
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
                          className="w-full text-white"
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

                      {message.role === "assistant" ? (
                        <div className="leading-relaxed text-sm md:text-base break-words markdown-content prose prose-invert prose-sm md:prose-base max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="leading-relaxed text-sm md:text-base break-words">
                          {message.content}
                        </p>
                      )}

                      {message.isStreaming && (
                        <div className="mt-2">
                          <StreamingDots />
                        </div>
                      )}
                      {message.sources && message.sources.length > 0 && (
                        <div className="mt-2 md:mt-3 flex flex-wrap gap-1 md:gap-2">
                          {message.sources.map((source, index) => (
                            <Badge
                              key={index}
                              variant="secondary"
                              className="text-xs bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 cursor-pointer"
                            >
                              <ExternalLink className="w-2 h-2 md:w-3 md:h-3 mr-1" />
                              <span className="truncate max-w-[100px] md:max-w-none">
                                {source}
                              </span>
                            </Badge>
                          ))}
                        </div>
                      )}
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
                      className="w-full text-white"
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

          <div className="flex space-x-2 md:space-x-4">
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
                    : "text-slate-400 hover:text-black"
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
                  isListening // Placeholder now considers isListening
                    ? "Listening..."
                    : sessionId
                    ? "Ask about satellite data..."
                    : "Initializing chat..."
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
                className="pl-10 pr-10 md:pl-12 md:pr-12 bg-slate-800/50 border-slate-600 text-white placeholder-slate-400 text-sm md:text-base resize-none overflow-y-hidden min-h-[40px] md:min-h-[auto] py-2" // Adjusted pr
                disabled={isInputAndSendDisabled}
              />

              {/* Re-added Mic button */}
              <Button
                size="sm"
                variant="ghost"
                className={`absolute right-1 md:right-2 bottom-1 p-1 md:p-2 ${
                  isListening
                    ? "text-red-500 animate-pulse" // Red and pulsing when listening
                    : "text-slate-400 hover:text-black" // Normal color when not listening
                }`}
                onClick={toggleListening}
                disabled={isLoadingSession || !sessionId || isTyping} // isMicButtonDisabled logic
                title={isListening ? "Stop Listening" : "Start Voice Input"}
              >
                {isListening ? (
                  <StopCircle className="w-3 h-3 md:w-4 md:h-4" />
                ) : (
                  <Mic className="w-3 h-3 md:w-4 md:h-4 " />
                )}
              </Button>
            </div>
            <Button
              onClick={() => handleSendMessage()}
              disabled={
                (!inputValue.trim() && !selectedImage) || isInputAndSendDisabled
              }
              className="bg-blue-600 hover:bg-blue-700 text-white h-10 md:h-auto px-3 md:px-4"
            >
              <Send className="w-3 h-3 md:w-4 md:h-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}