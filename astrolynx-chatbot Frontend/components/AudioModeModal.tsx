// src/components/AudioModeModal.tsx
import { Mic, Loader2, Speaker } from "lucide-react";
import { Button } from "./ui/button";

interface AudioModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioState: "listening" | "processing" | "speaking" | "idle";
  transcript: string;
}

const stateMap = {
  listening: {
    Icon: Mic,
    title: "Listening...",
    className: "text-red-500 animate-pulse",
  },
  processing: {
    Icon: Loader2,
    title: "Processing...",
    className: "animate-spin text-blue-400",
  },
  speaking: {
    Icon: Speaker,
    title: "Speaking...",
    className: "text-green-500 animate-pulse",
  },
  idle: { Icon: Mic, title: "Idle", className: "text-slate-400" },
};

export function AudioModeModal({
  isOpen,
  onClose,
  audioState,
  transcript,
}: AudioModeModalProps) {
  if (!isOpen) return null;

  const currentState = stateMap[audioState] || stateMap.idle;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-slate-900/80 border border-slate-700 p-8 rounded-2xl text-center flex flex-col items-center shadow-2xl w-full max-w-md">
        <currentState.Icon
          className={`w-16 h-16 mx-auto ${currentState.className}`}
        />
        <h2 className="text-2xl mt-4 font-bold text-white">
          {currentState.title}
        </h2>
        <p className="text-slate-300 mt-4 min-h-[50px] text-lg w-full break-words">
          {transcript || "..."}
        </p>
        <Button
          onClick={onClose}
          variant="ghost"
          className="mt-8 text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
