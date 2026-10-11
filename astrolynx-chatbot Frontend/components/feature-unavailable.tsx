import Link from "next/link"
import { ArrowLeft, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"

interface FeatureUnavailableProps {
  title: string
  description: string
}

export function FeatureUnavailable({ title, description }: FeatureUnavailableProps) {
  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16 text-center">
      <section className="max-w-xl rounded-2xl border border-slate-700/70 bg-slate-900/85 p-8 shadow-2xl backdrop-blur">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/15 text-blue-300">
          <MessageSquare aria-hidden="true" className="h-6 w-6" />
        </div>
        <p className="mb-2 text-sm font-medium uppercase tracking-[0.18em] text-blue-300">
          AstroLynx
        </p>
        <h1 className="mb-3 text-2xl font-semibold text-white">{title}</h1>
        <p className="mb-7 leading-7 text-slate-300">{description}</p>
        <Button asChild className="bg-blue-600 text-white hover:bg-blue-500">
          <Link href="/">
            <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />
            Return to chat
          </Link>
        </Button>
      </section>
    </main>
  )
}
