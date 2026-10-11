"use client";

import { Search, Plus, LogOut, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Conversation = {
  sessionId: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
};
export type AuthUser = { id: string; email: string; name: string };

export function ChatSidebar({
  user,
  conversations,
  activeSessionId,
  search,
  loading,
  open,
  onSearch,
  onNewChat,
  onSelect,
  onLogout,
  onClose,
}: {
  user: AuthUser;
  conversations: Conversation[];
  activeSessionId: string | null;
  search: string;
  loading: boolean;
  open: boolean;
  onSearch: (value: string) => void;
  onNewChat: () => void;
  onSelect: (sessionId: string) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {open && <button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-40 bg-black/60 lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(19rem,85vw)] flex-col border-r border-slate-700 bg-slate-950 text-slate-100 transition-transform lg:w-72 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
          <div>
            <p className="font-semibold">AstroLynx</p>
            <p className="text-xs text-slate-500">MOSDAC assistant</p>
          </div>
          <button onClick={onClose} aria-label="Close sidebar" className="rounded p-2 text-slate-400 hover:bg-slate-800 lg:hidden"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-3">
          <Button onClick={onNewChat} className="w-full justify-start bg-blue-600 hover:bg-blue-500"><Plus className="mr-2 h-4 w-4" />New chat</Button>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search chats" aria-label="Search chats by title" className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-600 focus:border-slate-600" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-slate-500">Recent</p>
          {loading && <p className="px-3 py-2 text-sm text-slate-500">Loading chats…</p>}
          {!loading && conversations.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">{search ? "No matching chats." : "Your chats will appear here."}</p>}
          <nav aria-label="Chat history" className="space-y-1">
            {conversations.map((conversation) => (
              <button
                key={conversation.sessionId}
                onClick={() => onSelect(conversation.sessionId)}
                title={conversation.title}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${activeSessionId === conversation.sessionId ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white"}`}
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate">{conversation.title}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 border-t border-slate-800 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <button onClick={onLogout} title="Sign out" aria-label="Sign out" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><LogOut className="h-4 w-4" /></button>
        </div>
      </aside>
    </>
  );
}
