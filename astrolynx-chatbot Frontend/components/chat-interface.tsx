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
  PanelLeft,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Image from "next/image";
import { Textarea } from "@/components/ui/textarea";

import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { AudioModeModal } from "@/components/AudioModeModal";
import { getSpeechRecognitionConstructor, SpeechRecognitionLike, SpeechRecognitionResultEventLike } from "@/lib/speech-recognition";
import { AuthCredentials, AuthPanel } from "@/components/auth-panel";
import { AuthUser, ChatSidebar, Conversation } from "@/components/chat-sidebar";

type ChatHistoryResponse = { history?: Message[] };

function isSessionId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: string;
  citations?: {
    id: string;
    title: string;
    source: string;
    page?: number;
    section?: string;
    url?: string;
  }[];
  isStreaming?: boolean;
  imageData?: string;
  audioData?: string;
};

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5001")
  .trim()
  .replace(/\/+$/u, "");

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "hi", name: "हिन्दी" },
  { code: "hi-en", name: "Hinglish" },
  { code: "de", name: "Deutsch" },
];
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function StreamingDots() {
  return (
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
}

export function ChatInterface() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [chatRequestError, setChatRequestError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechRecognitionAvailable, setSpeechRecognitionAvailable] = useState<boolean | null>(null);
  const [isAudioModalOpen, setIsAudioModalOpen] = useState(false);
  const [audioState, setAudioState] = useState<
    "idle" | "listening" | "processing" | "speaking"
  >("idle");
  const [selectedImage, setSelectedImage] = useState<{
    base64: string;
    previewUrl: string;
  } | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sessionInitializationStartedRef = useRef(false);
  const chatRequestControllersRef = useRef(new Set<AbortController>());
  const audioRequestControllerRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioModalActiveRef = useRef(false);
  const startModalListeningRef = useRef<() => void>(() => {});
  const closeAudioModalRef = useRef<() => void>(() => {});
  const imageReaderRef = useRef<FileReader | null>(null);

  useEffect(() => () => {
    audioModalActiveRef.current = false;
    chatRequestControllersRef.current.forEach((controller) => controller.abort());
    chatRequestControllersRef.current.clear();
    audioPlayerRef.current?.pause();
    audioPlayerRef.current = null;
  }, []);
  useEffect(() => () => {
    imageReaderRef.current?.abort();
    if (selectedImage?.previewUrl) URL.revokeObjectURL(selectedImage.previewUrl);
  }, [selectedImage]);
  const clearSelectedImage = useCallback(() => {
    imageReaderRef.current?.abort();
    imageReaderRef.current = null;
    setSelectedImage(null);
    setImageUploadError(null);
  }, []);

  // In chat-interface.tsx

  // In chat-interface.tsx

  // In chat-interface.tsx

  // In ChatInterface.tsx

  const handleAudioMessage = async (transcript: string) => {
    if (!audioModalActiveRef.current) return;
    console.log(
      `[ChatInterface] Handling finalized transcript: "${transcript}"`
    );
    if (!transcript.trim()) {
      console.log("[ChatInterface] Transcript was empty, re-listening...");
      startModalListeningRef.current(); // If user doesn't speak, just start listening again
      return;
    }

    setAudioState("processing");
    console.log("[ChatInterface] State changed to -> processing");
    setIsTyping(true);

    const requestController = new AbortController();
    audioRequestControllerRef.current = requestController;
    chatRequestControllersRef.current.add(requestController);
    const requestSessionId = activeSessionIdRef.current;

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
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: requestController.signal,
        body: JSON.stringify({
          message: transcript,
          sessionId: requestSessionId,
          isAudioMode: true,
          targetLanguage: selectedLanguage,
        }),
      });

      if (!response.ok) throw new Error("API call failed");

      const data = await response.json();
      if (requestController.signal.aborted || !audioModalActiveRef.current || activeSessionIdRef.current !== requestSessionId) return;
      const aiMessage: Message = data.aiMessage;

      console.log("[ChatInterface] Received response from backend.", data);
      setMessages((prev) => [...prev, aiMessage]);

      if (aiMessage && aiMessage.audioData && aiMessage.audioData.length > 50) {
        setAudioState("speaking");
        console.log("[ChatInterface] State changed to -> speaking");

        const audioPlayer = new Audio(
          `data:audio/mp3;base64,${aiMessage.audioData}`
        );
        audioPlayerRef.current = audioPlayer;

        // --- THIS IS THE KEY CHANGE ---
        // When the AI finishes speaking, start the next listening cycle automatically.
        audioPlayer.onended = () => {
          audioPlayerRef.current = null;
          console.log(
            "[ChatInterface] Audio playback finished. Looping back to listening state."
          );
          if (audioModalActiveRef.current) startModalListeningRef.current();
        };

        audioPlayer.onerror = (e) => {
          console.error("[ChatInterface] Error during audio playback:", e);
          // On error, we should probably close to prevent getting stuck in a loop
          closeAudioModalRef.current();
        };

        console.log("[ChatInterface] Attempting to play audio...");
        audioPlayer.play().catch((error) => {
          console.error(
            "[ChatInterface] Audio autoplay was prevented by the browser:",
            error
          );
          closeAudioModalRef.current();
        });
      } else {
        // If there's no audio data, immediately loop back to listening for the user's next turn.
        console.log(
          "[ChatInterface] No audio data in response, looping back to listening."
        );
        startModalListeningRef.current();
      }
    } catch (error) {
      if (requestController.signal.aborted) return;
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
      if (activeSessionIdRef.current === requestSessionId) setMessages((prev) => [...prev, errorMessage]);
      // Close the modal on a critical error
      closeAudioModalRef.current();
    } finally {
      chatRequestControllersRef.current.delete(requestController);
      if (audioRequestControllerRef.current === requestController) audioRequestControllerRef.current = null;
      if (activeSessionIdRef.current === requestSessionId) setIsTyping(false);
    }
  };

  const {
    transcript: modalTranscript,
    startListening: startModalListening,
    stopListening: stopModalListening,
  } = useAudioRecorder(handleAudioMessage);
  const listenForAudio = useCallback(() => {
    setAudioState("listening");
    startModalListening();
  }, [startModalListening]);
  const openAudioModal = () => {
    audioModalActiveRef.current = true;
    setIsAudioModalOpen(true);
    listenForAudio();
  };
  const closeAudioModal = useCallback(() => {
    audioModalActiveRef.current = false;
    audioRequestControllerRef.current?.abort();
    audioRequestControllerRef.current = null;
    stopModalListening();
    audioPlayerRef.current?.pause();
    audioPlayerRef.current = null;
    setIsAudioModalOpen(false);
    setAudioState("idle");
    setIsTyping(false);
  }, [stopModalListening]);
  useEffect(() => {
    startModalListeningRef.current = listenForAudio;
    closeAudioModalRef.current = closeAudioModal;
  }, [listenForAudio, closeAudioModal]);

  const scrollToBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [inputValue, selectedImage]);

  const fetchChatHistory = useCallback(async (currentSessionId: string): Promise<boolean> => {
    try {
      const response = await fetch(
        `${BASE_URL}/api/session/history/${currentSessionId}`,
        { credentials: "include" }
      );
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const data = (await response.json()) as ChatHistoryResponse;
      if (activeSessionIdRef.current !== currentSessionId) return true;
      if (Array.isArray(data.history)) {
        setMessages(
          data.history.filter((msg) =>
            msg && typeof msg.id === "string" && typeof msg.content === "string" &&
            (msg.role === "user" || msg.role === "assistant") && typeof msg.timestamp === "string"
          )
        );
      } else {
        setMessages([]);
      }
      setSessionError(null);
      return true;
    } catch (error) {
      console.error("Error fetching chat history:", error);
      if (activeSessionIdRef.current === currentSessionId) setSessionError("Could not restore this chat. Check your connection and try again.");
      return false;
    }
  }, []);

  const fetchConversations = useCallback(async (search = ""): Promise<Conversation[]> => {
    setIsLoadingConversations(true);
    try {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
      const response = await fetch(`${BASE_URL}/api/session${query}`, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json() as { conversations?: unknown };
      const items = Array.isArray(data.conversations)
        ? data.conversations.filter((item): item is Conversation =>
            typeof item === "object" && item !== null &&
            typeof (item as Conversation).sessionId === "string" &&
            typeof (item as Conversation).title === "string"
          )
        : [];
      setConversations(items);
      return items;
    } catch (error) {
      console.error("Error fetching conversation list:", error);
      return [];
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  const createConversation = useCallback(async (): Promise<void> => {
    setIsLoadingSession(true);
    setSessionError(null);
    try {
      const response = await fetch(`${BASE_URL}/api/session`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json() as { sessionId?: unknown };
      if (!isSessionId(data.sessionId)) throw new Error("Session service returned an invalid ID.");
      localStorage.setItem("chatSessionId", data.sessionId);
      activeSessionIdRef.current = data.sessionId;
      setSessionId(data.sessionId);
      setMessages([]);
      await fetchConversations(conversationSearch);
    } catch (error) {
      console.error("Error creating conversation:", error);
      setSessionError("Could not create a chat. Check your connection and retry.");
    } finally {
      setIsLoadingSession(false);
    }
  }, [conversationSearch, fetchConversations]);

  const establishSession = useCallback(async () => {
    setIsLoadingSession(true);
    setSessionError(null);
    try {
      const chats = await fetchConversations("");
      let currentSessionId: string | null = localStorage.getItem("chatSessionId");
      if (currentSessionId && !isSessionId(currentSessionId)) {
        localStorage.removeItem("chatSessionId");
        currentSessionId = null;
      }

      if (!currentSessionId || !chats.some((conversation) => conversation.sessionId === currentSessionId)) {
        currentSessionId = chats[0]?.sessionId ?? null;
      }

      if (currentSessionId) {
        localStorage.setItem("chatSessionId", currentSessionId);
        activeSessionIdRef.current = currentSessionId;
        setSessionId(currentSessionId);
        const historyLoaded = await fetchChatHistory(currentSessionId);
        if (!historyLoaded) throw new Error("Could not load the selected conversation.");
        return;
      }

      await createConversation();
    } catch (error) {
      console.error("Error establishing chat session:", error);
      setSessionError("Could not connect to AstroLynx. Check your connection and retry.");
    } finally {
      setIsLoadingSession(false);
    }
  }, [createConversation, fetchChatHistory, fetchConversations]);

  useEffect(() => {
    // Authentication is checked after mount so the cookie-backed session is never
    // read during server rendering.
    void fetch(`${BASE_URL}/api/auth/me`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json() as { user?: AuthUser | null };
        setUser(data.user ?? null);
      })
      .catch((error: unknown) => {
        console.error("Could not check sign-in state:", error);
        setAuthError("Could not connect to AstroLynx. Check the API and try again.");
      })
      .finally(() => {
        setHasMounted(true);
        setAuthChecked(true);
      });
  }, []);

  useEffect(() => {
    if (!authChecked || !user || sessionInitializationStartedRef.current) return;
    sessionInitializationStartedRef.current = true;
    void establishSession();
  }, [authChecked, establishSession, user]);

  useEffect(() => {
    if (!user) return;
    const timeout = window.setTimeout(() => void fetchConversations(conversationSearch), 250);
    return () => window.clearTimeout(timeout);
  }, [conversationSearch, fetchConversations, user]);

  const handleAuthSubmit = async (mode: "login" | "signup", credentials: AuthCredentials) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const response = await fetch(`${BASE_URL}/api/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const data = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || "Could not sign in.");
      localStorage.removeItem("chatSessionId");
      sessionInitializationStartedRef.current = false;
      setMessages([]);
      activeSessionIdRef.current = null;
      setSessionId(null);
      setUser(data.user);
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch (error) {
      console.error("Sign out request failed:", error);
    } finally {
      localStorage.removeItem("chatSessionId");
      sessionInitializationStartedRef.current = false;
      setUser(null);
      activeSessionIdRef.current = null;
      setSessionId(null);
      setMessages([]);
      setConversations([]);
      setSidebarOpen(false);
    }
  };

  const selectConversation = async (selectedSessionId: string) => {
    if (selectedSessionId === sessionId) {
      setSidebarOpen(false);
      return;
    }
    activeSessionIdRef.current = selectedSessionId;
    setIsTyping(false);
    setIsLoadingSession(true);
    setSessionId(selectedSessionId);
    localStorage.setItem("chatSessionId", selectedSessionId);
    setMessages([]);
    setChatRequestError(null);
    setSidebarOpen(false);
    const loaded = await fetchChatHistory(selectedSessionId);
    if (!loaded) {
      activeSessionIdRef.current = null;
      setSessionId(null);
    }
    setIsLoadingSession(false);
  };
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
      const requestSessionId = sessionId;
      setMessages((prev) => [...prev, newUserMessage]);
      setChatRequestError(null);
      setIsTyping(true);
      const requestController = new AbortController();
      chatRequestControllersRef.current.add(requestController);
      try {
        const response = await fetch(`${BASE_URL}/api/chat`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          signal: requestController.signal,
          body: JSON.stringify({
            message: messageToSend,
            sessionId: requestSessionId,
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
        if (requestController.signal.aborted) return;
        if (!data || typeof data.aiMessage?.content !== "string") {
          throw new Error("The chat service returned an invalid response.");
        }
        if (activeSessionIdRef.current === requestSessionId) {
          await fetchChatHistory(requestSessionId);
          setInputValue("");
          clearSelectedImage();
        }
        void fetchConversations(conversationSearch);
        window.setTimeout(() => void fetchConversations(conversationSearch), 2500);
      } catch {
        if (activeSessionIdRef.current === requestSessionId) setMessages((prev) => prev.filter((message) => message.id !== newUserMessage.id));
        if (requestController.signal.aborted) return;
        if (activeSessionIdRef.current === requestSessionId) setChatRequestError("Message wasn’t sent. Your draft is still here; try again when the service is available.");
      } finally {
        chatRequestControllersRef.current.delete(requestController);
        if (activeSessionIdRef.current === requestSessionId) setIsTyping(false);
      }
    },
    [sessionId, selectedImage, inputValue, selectedLanguage, clearSelectedImage, conversationSearch, fetchConversations, fetchChatHistory]
  );

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    // Browser capability is only known after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeechRecognitionAvailable(Boolean(SpeechRecognition));
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: SpeechRecognitionResultEventLike) => {
      const interimTranscript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");
      setInputValue(interimTranscript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: { error: string }) => {
      setIsListening(false);
      console.error("[STT onerror]:", event.error);
    };
    recognitionRef.current = recognition;
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
    };
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
    event.target.value = "";
    if (!file) return;

    setImageUploadError(null);
    if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
      setImageUploadError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setImageUploadError("Choose an image smaller than 5 MB.");
      return;
    }

    imageReaderRef.current?.abort();
    const reader = new FileReader();
    imageReaderRef.current = reader;
    reader.onload = () => {
      if (imageReaderRef.current !== reader) return;
      imageReaderRef.current = null;
      if (typeof reader.result !== "string") {
        setImageUploadError("The selected image could not be read. Try another file.");
        return;
      }
      setSelectedImage({
        base64: reader.result,
        previewUrl: URL.createObjectURL(file),
      });
    };
    reader.onerror = () => {
      if (imageReaderRef.current !== reader) return;
      imageReaderRef.current = null;
      setImageUploadError("The selected image could not be read. Try another file.");
    };
    reader.onabort = () => {
      if (imageReaderRef.current === reader) imageReaderRef.current = null;
    };
    reader.readAsDataURL(file);
  };

  const handleImageButtonClick = () => {
    if (isInputAndSendDisabled || isListening) return;
    fileInputRef.current?.click();
  };

  const handleNewChat = () => {
    activeSessionIdRef.current = null;
    closeAudioModal();
    setSessionId(null);
    setSessionError(null);
    setChatRequestError(null);
    setMessages([]);
    setInputValue("");
    setIsTyping(false);
    clearSelectedImage();
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
    setSelectedLanguage("en");
    setSidebarOpen(false);
    void createConversation();
  };

  const showWelcomeMessage = messages.length === 0 && !isLoadingSession;
  const isInputAndSendDisabled =
    isTyping || isLoadingSession || !sessionId || isListening || isAudioModalOpen || Boolean(sessionError);

  if (!authChecked) {
    return <div className="flex min-h-screen items-center justify-center text-slate-300"><Loader2 className="mr-3 h-5 w-5 animate-spin" />Checking your account…</div>;
  }
  if (!user) {
    return <AuthPanel busy={authBusy} error={authError} onSubmit={handleAuthSubmit} />;
  }

  return (
    <>
      <ChatSidebar
        user={user}
        conversations={conversations}
        activeSessionId={sessionId}
        search={conversationSearch}
        loading={isLoadingConversations}
        open={sidebarOpen}
        onSearch={setConversationSearch}
        onNewChat={handleNewChat}
        onSelect={(selectedSessionId) => void selectConversation(selectedSessionId)}
        onLogout={() => void handleLogout()}
        onClose={() => setSidebarOpen(false)}
      />
    <div className="flex-1 flex flex-col bg-slate-900/40 min-h-0 relative pt-20 lg:ml-72">
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="fixed left-4 top-4 z-30 rounded-full bg-slate-700 p-3 text-white shadow-lg hover:bg-slate-600 lg:hidden"
        title="Open chat history"
        aria-label="Open chat history"
      ><PanelLeft className="h-5 w-5" /></button>
      {/* --- BUTTONS RESTORED --- */}
      <div className="fixed top-4 right-4 z-50 flex space-x-3">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="relative"
        >
          <select
            aria-label="Assistant response language"
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
            disabled={hasMounted && isLoadingSession}
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
        {sessionError && (
          <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-center gap-3 rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-sm text-amber-100" role="alert">
            <span>{sessionError}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void establishSession()}
              disabled={isLoadingSession}
            >
              {isLoadingSession ? "Retrying…" : "Retry"}
            </Button>
          </div>
        )}
        <div
          role="log"
          aria-label="Conversation"
          aria-live="polite"
          aria-relevant="additions"
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
                          <Image
                            src={message.imageData}
                            alt="Uploaded by user"
                            width={800}
                            height={600}
                            unoptimized
                            className="max-w-full h-auto rounded-md"
                            style={{ maxHeight: "200px", objectFit: "contain" }}
                          />
                        </div>
                      )}
                      <div className="leading-relaxed text-sm md:text-base break-words markdown-content prose prose-invert prose-sm md:prose-base max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content
                            .replace(/\n\nSources:\n[\s\S]*$/u, "")
                            .replace(/\s*\[S\d+(?:\s*,\s*S\d+)*\]/gu, "")}
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
              role="status"
              aria-label="Assistant is responding"
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
                  <div aria-hidden="true"><StreamingDots /></div>
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
          {chatRequestError && (
            <p className="mb-2 text-sm text-amber-200" role="alert">
              {chatRequestError}
            </p>
          )}
          {imageUploadError && (
            <p className="mb-2 text-sm text-red-300" role="alert">
              {imageUploadError}
            </p>
          )}
          {selectedImage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="relative mb-3 p-2 border border-slate-600 rounded-lg bg-slate-800/50 flex items-center justify-center"
            >
              <Image
                src={selectedImage.previewUrl}
                alt="Preview"
                width={800}
                height={600}
                unoptimized
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
                accept="image/png,image/jpeg,image/webp"
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
                aria-label="Upload image"
              >
                <ImageIcon className="w-4 h-4 md:w-5 md:h-5" />
              </Button>
              <Textarea
                ref={textareaRef}
                aria-label="Message to AstroLynx"
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
                disabled={isLoadingSession || !sessionId || isTyping || !speechRecognitionAvailable}
                title={isListening ? "Stop Listening" : "Start Voice Input"}
                aria-label={isListening ? "Stop voice input" : "Start voice input"}
              >
                {isListening ? (
                  <StopCircle className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </Button>
            </div>
            {speechRecognitionAvailable === false && (
              <span className="sr-only" role="status">
                Voice input is not supported by this browser. Type your question instead.
              </span>
            )}
            <Button
              onClick={openAudioModal}
              disabled={isInputAndSendDisabled || !speechRecognitionAvailable}
              className="bg-green-600 hover:bg-green-700 text-white h-full px-3 md:px-4"
              title="Start Voice Chat"
              aria-label="Start voice chat"
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
    </>
  );
}
