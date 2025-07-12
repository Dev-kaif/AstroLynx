"use client";

import { useState, useRef, useEffect, useCallback, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Mic,
  User,
  Bot,
  ExternalLink,
  Loader2,
  PlusCircle,
  StopCircle,
  Image as ImageIcon, // Renamed to avoid conflict with HTML Image element
  XCircle, // For clearing image preview
} from "lucide-react";

// Import ReactMarkdown and remarkGfm
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import Image from "next/image";
import { Textarea } from "./ui/textarea";

// User's provided global type declarations
declare global {
  interface Window {
    SpeechRecognition: any;
    SpeechRecognitionEvent: any;
  }
}

// Define the Message type to match backend's structured output
type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: string;
  sources?: string[];
  isStreaming?: boolean;
  imageData?: string; // NEW: Optional Base64 image data for user messages
};

const BASE_URL = "http://localhost:5000"; // Your backend URL (adjusted to 3000)

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);

  // NEW: State for image upload
  const [selectedImage, setSelectedImage] = useState<{
    base64: string;
    previewUrl: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); // Ref for hidden file input

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

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
        setMessages([]); // Ensure messages are empty if no history
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
      setMessages([]); // Start with an empty message array
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

  // --- Speech-to-Text (STT) Logic ---
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // Listen for a single utterance
      recognition.interimResults = true; // Get interim results as the user speaks
      recognition.lang = "en-US"; // Set language

      recognition.onstart = () => {
        setIsListening(true);
        setRecognitionError(null);
        console.log("Speech recognition started");
      };

      recognition.onresult = (event: any) => {
        const interimTranscript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join("");
        setInputValue(interimTranscript);
      };

      recognition.onend = () => {
        setIsListening(false);
        console.log("Speech recognition ended");
        // Only send message if there's actual speech input
        if (inputValue.trim()) {
          // Use current inputValue from state
          handleSendMessage();
        }
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        console.error("Speech recognition error:", event.error);
        let errorMessage = "Speech recognition error.";
        if (event.error === "not-allowed") {
          errorMessage =
            "Microphone permission denied. Please allow access in your browser settings.";
        } else if (event.error === "no-speech") {
          errorMessage = "No speech detected. Please try again.";
        } else if (event.error === "audio-capture") {
          errorMessage = "No microphone found or audio capture failed.";
        }
        setRecognitionError(errorMessage);
        console.error(errorMessage);
      };

      recognitionRef.current = recognition;

      return () => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      };
    } else {
      setRecognitionError("Speech recognition not supported in this browser.");
      console.warn("SpeechRecognition API not supported in this browser.");
    }
  }, []);

  const toggleListening = () => {
    if (recognitionRef.current) {
      if (isListening) {
        recognitionRef.current.stop();
      } else {
        setInputValue("");
        setRecognitionError(null);
        recognitionRef.current.start();
      }
    }
  };
  // --- End STT Logic ---

  // NEW: Image Upload Handlers
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type (optional)
      if (!file.type.startsWith("image/")) {
        alert("Please upload an image file (e.g., JPG, PNG, GIF).");
        return;
      }
      // Validate file size (optional, e.g., 5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        alert("Image file size exceeds 5MB limit.");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({
          base64: reader.result as string,
          previewUrl: URL.createObjectURL(file), // Create object URL for preview
        });
      };
      reader.readAsDataURL(file); // Read file as Base64
    }
  };

  const handleImageButtonClick = () => {
    fileInputRef.current?.click(); // Trigger hidden file input click
  };

  const clearSelectedImage = () => {
    if (selectedImage?.previewUrl) {
      URL.revokeObjectURL(selectedImage.previewUrl); // Clean up object URL
    }
    setSelectedImage(null);
  };

  const handleSendMessage = async () => {
    // Allow sending message with only image, or only text, or both
    if (!inputValue.trim() && !selectedImage) return;
    if (!sessionId) return;

    const userMessageContent = inputValue;
    const newUserMessage: Message = {
      id: Date.now().toString(),
      content: userMessageContent,
      role: "user",
      timestamp: new Date().toISOString(),
      imageData: selectedImage?.base64, // Include Base64 image data if present
    };

    setMessages((prev) => [...prev, newUserMessage]);
    setInputValue("");
    clearSelectedImage(); // Clear selected image after sending
    setIsTyping(true);

    try {
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessageContent,
          sessionId: sessionId,
          imageData: newUserMessage.imageData, // Pass imageData to backend
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

      const aiMessage = data.aiMessage || data.reply; // Fallback for aiMessage or reply

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
  };

  const handleNewChat = () => {
    localStorage.removeItem("chatSessionId");
    setSessionId(null);
    setMessages([]);
    setIsTyping(false);
    clearSelectedImage(); // Clear image on new chat
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

  // Determine if we should show the "start screen" welcome message
  const showWelcomeMessage = messages.length === 0 && !isLoadingSession;

  return (
    <div className="flex-1 flex flex-col bg-slate-900/40 backdrop-blur-sm min-h-0 relative">
      {/* Floating New Chat Button */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="fixed top-4 right-4 z-50"
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

      {/* Main Chat Messages Area */}
      <div
        className="flex-1 overflow-y-auto p-3 md:p-6 custom-scrollbar"
        aria-live="polite"
      >
        {/* Conditionally rendered Welcome Message */}
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

        {/* Actual Chat Messages (always at the bottom when present) */}
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
                      {/* Display image if present in user message */}
                      {message.role === "user" && message.imageData && (
                        <div className="mb-2 rounded-lg overflow-hidden border border-slate-600">
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
                  <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                    <Bot className="w-3 h-3 md:w-4 md:h-4 text-white" />
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

          {recognitionError && (
            <div className="flex justify-center items-center text-red-400 py-2 text-sm">
              <span className="mr-2">⚠️</span> {recognitionError}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area - Responsive */}
      <motion.div
        layout // Enable layout animations
        className="p-3 md:p-6 border-t border-slate-700/50 bg-slate-900/80 backdrop-blur-md"
      >
        <div className="max-w-4xl mx-auto">
          {/* NEW: Image Preview Area (moved here) */}
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
              {/* Hidden file input */}
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: "none" }}
              />

              {/* Image Upload Button (inside the Input's container) */}
              <Button
                size="sm"
                variant="ghost"
                className={`absolute left-1 md:left-2 top-1/2 transform -translate-y-1/2 p-1 md:p-2 ${
                  isLoadingSession || !sessionId || isTyping || isListening
                    ? "text-slate-600 cursor-not-allowed"
                    : "text-slate-400 hover:text-black"
                }`}
                onClick={handleImageButtonClick}
                disabled={
                  isLoadingSession || !sessionId || isTyping || isListening
                }
                title="Upload Image"
              >
                <ImageIcon className="w-4 h-4 md:w-5 md:h-5" />
              </Button>

              <Textarea
                ref={textareaRef} // Assign ref to Textarea
                placeholder={
                  isListening
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
                // Adjusted padding-left and padding-right to make space for buttons
                // Removed fixed height, added min-h, py-2
                className="pl-10 pr-10 md:pl-12 md:pr-12 bg-slate-800/50 border-slate-600 text-white placeholder-slate-400 text-sm md:text-base resize-none overflow-y-hidden min-h-[40px] md:min-h-[auto] py-2"
                disabled={
                  isTyping || isLoadingSession || !sessionId || isListening
                }
              />

              <Button
                size="sm"
                variant="ghost"
                className={`absolute right-1 md:right-2 top-1/2 transform -translate-y-1/2 p-1 md:p-2 ${
                  isListening
                    ? "text-red-500 animate-pulse"
                    : "text-slate-400 hover:text-black"
                }`}
                onClick={toggleListening}
                disabled={isLoadingSession || !sessionId || isTyping}
                title={isListening ? "Stop Listening" : "Start Voice Input"}
              >
                {isListening ? (
                  <StopCircle className="w-3 h-3 md:w-4 md:h-4" />
                ) : (
                  <Mic className="w-3 h-3 md:w-4 md:h-4" />
                )}
              </Button>
            </div>
            <Button
              onClick={handleSendMessage}
              disabled={
                (!inputValue.trim() && !selectedImage) || // Disable if no text AND no image
                isTyping ||
                isLoadingSession ||
                !sessionId ||
                isListening
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
