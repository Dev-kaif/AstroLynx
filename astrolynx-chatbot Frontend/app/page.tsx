import { StarfieldBackground } from "@/components/starfield-background";
import { ChatInterface } from "@/components/chat-interface";

export default function Page() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
       <StarfieldBackground />
      <main className="flex flex-col lg:flex-row h-screen">
        <div className="min-h-screen w-full bg-slate-900 flex flex-col font-sans antialiased">
          <ChatInterface />
        </div>
      </main>
    </div>
  );
}
