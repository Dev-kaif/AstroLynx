"use client";

import { FormEvent, useState } from "react";
import { Loader2, Orbit } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AuthCredentials = { email: string; name?: string; password: string };

export function AuthPanel({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (mode: "login" | "signup", credentials: AuthCredentials) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(mode, { email, ...(mode === "signup" ? { name } : {}), password });
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/95 p-7 shadow-2xl backdrop-blur">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-blue-500/15 p-3 text-blue-300"><Orbit className="h-6 w-6" /></div>
          <div>
            <h1 className="text-2xl font-semibold">AstroLynx</h1>
            <p className="text-sm text-slate-400">Your MOSDAC research assistant</p>
          </div>
        </div>
        <div className="mb-6 grid grid-cols-2 rounded-lg bg-slate-800 p-1">
          {(["login", "signup"] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setMode(choice)}
              className={`rounded-md px-3 py-2 text-sm capitalize ${mode === choice ? "bg-slate-600 text-white" : "text-slate-400 hover:text-white"}`}
            >{choice === "login" ? "Sign in" : "Create account"}</button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <label className="block space-y-1.5 text-sm text-slate-300">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoComplete="name" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-blue-400" />
            </label>
          )}
          <label className="block space-y-1.5 text-sm text-slate-300">
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="email" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-blue-400" />
          </label>
          <label className="block space-y-1.5 text-sm text-slate-300">
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === "signup" ? 10 : 1} maxLength={256} autoComplete={mode === "signup" ? "new-password" : "current-password"} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-blue-400" />
            {mode === "signup" && <span className="block text-xs text-slate-500">Use at least 10 characters.</span>}
          </label>
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full bg-blue-600 hover:bg-blue-500">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Please wait…</> : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </section>
    </main>
  );
}
