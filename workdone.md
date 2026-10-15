# AstroLynx Rewrite Work Log

This file is the durable handoff log for the AstroLynx rewrite. Update it in the same change as implementation work. A future contributor should read this file first, then `REWRITE_PLAN.md`, then the relevant source files.

## Current status

- **Rewrite stage:** Phase 0 inventory complete; workspace/config and bounded MOSDAC crawl/PDF inspection foundations implemented. The first-page sample covers every local PDF; the chunk planner now has corpus-wide page/byte/estimated-token ceilings. The frontend lint gate is active and clean. Browser rendering works on both known JavaScript catalog pages; both live responses were empty. ISROCast has durable per-entry records verified end-to-end. RAG now supports an optional BM25 sidecar fused with legacy dense Pinecone results; BM25 preserves Indic combining marks, follow-up anchoring recognizes common Hindi/Hinglish continuations, query/dense-search cache telemetry is available, and citations are restored as structured fields from saved answer footers. A retrieval evaluator plus a ten-query, self-authored provisional seed set exist. Crawler state and each feed snapshot now have separate exclusive writer locks. The API chat-history response and LLM conversation-history input now have independent bounds. This is diagnostic only: there is no independent MOSDAC gold set, calibrated production index, or measured end-to-end answer-quality result. Corpus-wide quality calibration and full frontend migration remain outstanding.
- **Current worktree:** the original app directories remain in `Backend/` and `astrolynx-chatbot Frontend/`. Reference clones remain in `references/`. The root workspace files, corpus manifest, `REWRITE_PLAN.md`, and this log are new. `.gitignore` already had the `references` ignore change from the reference-cloning step; that rule has been retained and newline-normalized while adding generated workspace artifact ignores.
- **Implementation shipped in this pass:** root pnpm workspace, validated config, PDF quality inspection/chunk-plan/lexical-sidecar dry runs, bounded MOSDAC static/browser crawl, deterministic catalog/feed extraction and persistence, lower-fanout hybrid-capable RAG path, text/provenance screening, internal source citation validation, account login with owner-scoped conversations, searchable chat sidebar, question-based titles refined in the background, graceful API shutdown and request rate limits, chat/history validation, configurable frontend API origin, frontend lint enforcement, and tighter request/logging limits. User-facing source display is currently suppressed because the indexed corpus is a local PDF with unusable local-path provenance.
- **Validation:** Latest API typecheck/build, frontend typecheck/lint/build, and `git diff --check` pass. Next.js build runs lint and type validation. Full 56-PDF chunk-plan sample skipped seven duplicate copies before page parsing and produced 346 chunks / 157,575 estimated tokens without vector writes. Read-only corpus sample inspected 56 PDFs / 423 pages. Live samples rendered both catalog pages and fetched ISROCast; both catalogs explicitly returned no products. New RSS listing crawl still cannot fetch MOSDAC from this environment. No tests were added or run. Host Node 26.5 continues to warn against the project’s Node 24 pin.
- **Safety:** no database, vector index, Neo4j graph, downloaded documents, or reference repository was modified or deleted.

## Rewrite objective

Build a dependable MOSDAC assistant, prioritizing source quality, accurate citations, reproducible ingestion, and low query/embedding cost. The previous ingestion produced thousands of pages with substantial gibberish; therefore, raw page count must never be treated as success. Text quality must be assessed before chunks are embedded, and every answer citation must trace to a retained page/section and parser/index version.

The detailed intended architecture, quality gates, crawl behavior, retrieval strategy, and acceptance criteria are in [`REWRITE_PLAN.md`](./REWRITE_PLAN.md). Reference implementations were cloned for analysis under `references/`; their lessons are also recorded there. No reference code has been executed.

## Work completed

### Add account authentication and owner-scoped conversation history

- Added sign-up, sign-in, sign-out, and current-user endpoints. Passwords use Node `scrypt` with per-account random salts. Login uses opaque random tokens in HttpOnly, SameSite=Lax cookies; only token hashes are stored, and MongoDB TTL plus explicit logout revokes sessions. Mongo indexes cover unique normalized email, hashed tokens, expiration, and owner/recent-conversation queries.
- Added authentication and same-origin checks to chat and conversation routes, plus an auth rate limit. Chat/history endpoints now reject conversations not owned by the signed-in account. The browser uses credentialed requests; CORS is configured for credentials.
- Added a login/sign-up panel and responsive conversation sidebar with new chat, history selection, and debounced title search. Existing anonymous sessions are left in the database but are not silently assigned to an account.
- New chats receive an immediate first-question-derived title. A background request uses a separately configured small Gemini model (`GEMINI_TITLE_MODEL`, default `gemini-3.5-flash-lite`) to refine it; failure leaves the readable fallback title. The model ID was selected from Google's current Gemini model list.
- Updated `architecture.md` and `README.md` with current authentication, conversation-title, and RAG behavior. API TypeScript, frontend TypeScript, frontend ESLint on changed components, and `git diff --check` pass. No account/database integration or real title-model call was run; those require the configured MongoDB and Gemini services.

### Document the current RAG architecture and workflows

- Added [`architecture.md`](./architecture.md) as a code-based handoff: online chat flow, LangGraph routes, query transformation, dense/optional BM25 retrieval, RRF, evidence packing, answer/citation behavior, audio, and MongoDB persistence.
- Added separate PDF preparation and MOSDAC crawler workflows, Mermaid flowcharts, a source-file map, performance notes, and explicit boundaries: crawler output is not automatically embedded, there is no new dense Pinecone ingestion command, and the current UUID conversation model has no authentication/ownership.
- No implementation behavior or external data changed for this documentation task. `git diff --check` is the documentation formatting verification.

### Preserve image answers without document citations

- When a turn includes an image and retrieval also returned MOSDAC documents, answer validation previously rejected the whole answer if Gemini described the image without citing a retrieved document. The model prompt already permits directly visible image observations without document citations.
- The validator now returns the complete generated answer and no document citations for that case. If the response cites any unsupported source ID, it remains rejected; image turns with valid document citations still go through normal cited-content handling.
- API TypeScript check and `git diff --check` passed. No Gemini request was sent.

### Restore image input with Gemini 3 model names

- Traced the image turn's immediate `answer_generation` error to the Gemini adapter's local multimodal capability check. The installed 0.2.18 adapter recognized `gemini-1.5` and `gemini-2` models but not `gemini-3*`, so it threw before making a Gemini request when configured as `gemini-3.5-flash`.
- An attempted upgrade to `@langchain/google-genai` 2.3.2 added Gemini 3 recognition but requires `@langchain/core` 1.2, incompatible with this repository's LangChain 0.3 / Core 0.3 dependency graph. Restarting with that version produced a package export error (`@langchain/core/errors`); that upgrade was reverted.
- Kept the compatible 0.2.18 adapter and added a small subclass in `initializeChatService.ts` that extends its multimodal model-name check for `gemini-3*`. Its existing image data-URL conversion remains in use. The model's actual support for the configured alias still needs an image request to verify.
- API TypeScript check passed after the compatibility shim (`Backend/node_modules/.bin/tsc --noEmit`). A temporary API process started successfully on port 5002, confirming the export/startup error is gone; it was stopped afterward. No Gemini image request has been sent by this work. Restart the normal API process and retry an image question to verify the provider accepts the configured model and image payload.

### Hide local-PDF source labels in chat responses for now

- Removed the generated `Sources:` footer from newly persisted and returned assistant messages. Citation validation and citation objects remain in the backend so grounding behavior is preserved and useful link-based citations can be re-enabled after ingestion provides trustworthy MOSDAC URLs.
- The frontend no longer renders a “Retrieved sources” block. It also hides inline `[S#]` markers and strips legacy `Sources:` footers when rendering prior chat history, so local paths such as `/home/.../MOSDAC.pdf` are not shown to users.
- No citations, retrieval metadata, or index records are deleted. This is a presentation choice for the current one-PDF corpus; source display can return once URLs identify useful MOSDAC pages or documents.

### Supported-language greetings bypass retrieval

- Extended deterministic greeting recognition to common exact greetings in Hindi, Hinglish, Spanish, French, and German. These route to the existing localized greeting response instead of invoking query embedding, Pinecone, and optional BM25 for a greeting.
- The match remains anchored to the entire message, so substantive questions still enter retrieval.
- `CI=true pnpm typecheck:api` and `git diff --check` passed. No provider calls or index writes were made.

### Unsupported browser voice controls now fail clearly

- The chat and audio-mode microphone controls now stay disabled until browser speech-recognition support is confirmed. If unavailable, the UI provides a screen-reader status directing the user to type instead of leaving a microphone button that silently does nothing.
- Voice recognition remains the browser Web Speech API in `en-US`; this change does not add Hindi/Hinglish transcription support.
- `CI=true pnpm typecheck:web`, `CI=true pnpm lint:web`, and `git diff --check` passed. No tests or external services were used.

### Chat conversation announcements and input labels

- Removed the live region from the entire scrolling chat area and made only the conversation log announce appended messages. This avoids screen readers re-announcing the full conversation after every turn.
- Marked the typing indicator as an accessible status, hid its decorative dots, and added explicit labels for the message field, image upload, voice input toggle, and voice chat action.
- `CI=true pnpm typecheck:web`, `CI=true pnpm lint:web`, and `git diff --check` passed. No tests or provider calls were run.

### Restored structured citations when loading chat history

- `main.ts` saves the assistant's rendered source footer in message text, while the history API previously returned only that text and omitted the structured `citations` array. The UI therefore could not render the same source list after a reload.
- `sessionController.ts` now parses the exact source-footer format for both legacy embedded session messages and newer per-message records, returns the answer text without the footer, and adds structured citation fields for the existing UI. Parsing fails closed: if any footer line is malformed or duplicated, it preserves the original message text instead of dropping it.
- Recovered source links are returned as clickable URLs only when they use HTTPS and an allowed MOSDAC hostname. This is a read-only compatibility fix; no Mongo documents were migrated or rewritten.
- `CI=true pnpm typecheck:api` and `git diff --check` passed. No tests or database operations were run.

### Context token counting verified as local

- Inspected the installed LangChain core implementation used by `buildContext`: `getNumTokens` uses a local `tiktoken` encoding when available and otherwise estimates `ceil(characters / 4)`. It does not call Gemini or add a remote token-count request.
- No change was made; the suspected network-latency issue was not present. This estimate may still differ from Gemini's tokenizer, so context sizing should be evaluated against actual request limits before changing the packing policy.

### Answer validation checks citations per paragraph

- Strengthened the answer instructions and post-generation validation in `Backend/src/Services/ChatWithLLM.ts`: when retrieved evidence exists, each non-heading answer paragraph must contain a current-turn source marker. An answer that omits citations entirely or has an uncited paragraph now falls back to the localized grounding response and removes the source list.
- This is a lightweight formatting guard. A citation in a paragraph does not prove that it entails every claim there; semantic support still needs a reviewed answer benchmark.
- `CI=true pnpm typecheck:api` and `git diff --check` passed. No tests, embeddings, provider calls, or index writes were involved.

### Provisional BM25 baseline recorded

- Ran the read-only lexical evaluator against `/tmp/astrolynx-bm25-validated.json` (346 chunks; the provisional first-eight-pages-per-PDF planning sample) and `docs/evaluation/mosdac-seed-queries.provisional.json` (10 self-authored queries), with `k=5` and five measured repetitions per query.
- Results: hit rate@5 1.00, recall@5 1.00, MRR 0.778, nDCG@5 0.824; warm in-memory BM25 p50 0.072 ms / p95 0.140 ms in this local run. One query had its first labeled page at rank 5, lowering MRR; the output also shows several near-duplicate pages in the top five.
- These scores are only a wiring/provisional diagnostic. The query set is not independently adjudicated, the corpus is a partial sample, and the evaluator measures BM25 alone—not dense/hybrid quality, answer support, or end-to-end latency. Do not use this score to claim production accuracy or adjust release thresholds.
- No network, embedding provider, Pinecone, or vector-index write was involved. The initial attempt used a dataset path relative to the backend package and failed to find it; rerunning with the correct absolute path completed successfully.

### Follow-up retrieval recognizes non-English references

- Extended the existing deterministic, no-model-call follow-up query anchoring in `Backend/src/Services/Retrival.ts` to recognize common Hinglish, Hindi (Devanagari), Spanish, French, and German continuation phrases in addition to English.
- Removed the previous Latin-only gate. For a recognized short follow-up, retrieval now combines the prior user question (capped at 400 characters) with the current wording, so pronouns such as Hindi `इसका` / Hinglish `iska` can retrieve with their conversational subject.
- Ordinary standalone questions remain unchanged, and no translation or extra LLM call is introduced. This improves context carry-over but does not establish cross-lingual embedding compatibility or quality; that still requires reviewed retrieval labels.
- `CI=true pnpm typecheck:api` and `git diff --check` are the current code checks for this retrieval-focused phase; no model calls, embeddings, or index writes were performed.

### Bounded cache avoids repeated dense search calls

- Added a 30-second process-local cache around screened Pinecone results in `Backend/src/Services/Retrival.ts`. Exact repeated queries can now skip both Ollama query embedding and Pinecone search while their cached result is fresh; concurrent identical requests share one in-flight dense search.
- Cache keys hash the exact query together with the configured Pinecone index name and query-model name. The query and hash are never logged. Cache capacity is limited to 64 entries, and each entry is stored only when its returned passage text totals at most 100,000 characters; successful empty results are cacheable too.
- The 30-second TTL bounds staleness when the underlying index is updated. This cache is an optimization only and does not improve retrieval relevance. Stage logs distinguish computed searches, hits, coalesced requests, and errors so real latency/reuse can be measured.
- No index writes or embedding generation were run. `CI=true pnpm typecheck:api` passed after implementation; this checks types but does not establish cache behavior or end-to-end latency.

### Query embedding cache now reports its real latency and reuse

- Added privacy-safe `query_embedding` stage timings in `Backend/src/Services/cachedEmbeddings.ts` for Ollama-computed vectors, exact cache hits, same-query in-flight coalescing, and failures. Logs include duration, cache size, vector dimension, and error class only; they never include query text or its hash.
- This makes the existing five-minute/128-entry cache measurable so later optimization can compare its actual hit rate and latency impact instead of assuming it makes RAG faster. It does not change vector generation, cache keys, TTL, Pinecone, or document embeddings.
- No tests, provider calls, or embedding/index writes were run for this instrumentation.

### Hindi BM25 tokenization preserves combining marks

- Fixed the BM25 tokenizer in `Backend/src/ingestion/lexicalIndex.ts` to retain Unicode combining marks inside words. Devanagari vowel signs and related script marks were previously excluded by the token pattern, which could split one Hindi word into incomplete pieces and prevent exact query/document matches.
- This affects the optional lexical retrieval path only. Existing dense embeddings and vector data are unchanged. Because the sidecar stores source text and rebuilds its in-memory postings on load, the tokenizer fix does not require regenerating the BM25 sidecar or re-embedding documents.
- Scope remains deliberately limited: BM25 can match shared Hindi terms when both the query and retained source text contain them. It cannot translate Hindi queries to English or provide cross-lingual semantic retrieval; the active `nomic-embed-text` dense path remains unvalidated for Hindi/Hinglish.
- No tests, embeddings, sidecar builds, or external data writes were run for this change.

### Frontend lint gate restored

- Added `eslint@^8.57.0`, `eslint-config-next@15.2.4`, and `.eslintrc.json` extending `next/core-web-vitals` and `next/typescript`. ESLint 8 is deprecated and remains paired with the existing Next.js 15.2.4 version for compatibility; dependency modernization is a separate planned review.
- Removed `eslint.ignoreDuringBuilds` from Next configuration and added root `pnpm lint` / `pnpm lint:web` commands. The production web build now runs the checks rather than skipping lint.
- Fixed all reported errors and warnings in the current frontend lint scope: removed unused icons/parameters, typed chat history and caught errors, replaced chat-side speech recognition `any` types with `lib/speech-recognition.ts`, corrected hook callback dependencies, fixed the toast action type declaration, and used `next/image` for local uploaded-image previews.
- `pnpm-workspace.yaml` disables the optional `unrs-resolver` install build script; lint runs successfully without it. The first install attempt stopped at ignored-build approval, then an explicit `false` setting allowed a clean frozen workspace install. This script policy should be revisited if another dependency requires that optional resolver.
- Validation: `CI=true pnpm typecheck:web && CI=true pnpm lint:web` passed with zero ESLint warnings/errors; `CI=true pnpm build:web` passed and reported lint/type checking in the build. Node 26.5 still warns because the project pins Node 24.

### Feed snapshot integrity follow-up

- `Backend/src/ingestion/feedEntryStore.ts` now rejects duplicate stable entry IDs within a single complete snapshot rather than silently retaining whichever duplicate happened to appear last. This makes ambiguous feed extraction visible and prevents incorrect created/updated counts from being reported as a clean reconciliation.
- Atomic JSON temp files now use a random UUID in addition to the process ID, avoiding same-millisecond filename collisions between concurrent writes. A failed write/rename attempts to remove only its own temporary file and rethrows the original error; committed entry and manifest files are still only replaced by rename.
- This change does not add cross-process feed locking. Two simultaneous crawls of the same feed can still race while reconciling a manifest, so schedule one writer per feed until locking is added.

### Corpus-wide PDF planning budgets

- `Backend/src/ingestion/planPdfChunks.ts` now enforces aggregate `maxTotalPages` and `maxTotalBytes` in addition to its per-file and document caps. Defaults are 2,000 pages and 1 GiB, with hard CLI/API input ceilings of 20,000 pages and 5 GiB.
- It also enforces an aggregate `maxTotalTokens` planning allowance (200,000 default, 2,000,000 hard ceiling). It skips whole pages whose planned chunks exceed the remaining estimate and skips subsequent documents once the budget is fully consumed. Token counts use the existing `ceil(characters / 4)` estimate, not the configured embedding provider's tokenizer.
- It skips a file before reading it if its size exceeds the remaining aggregate byte budget. It limits each parser invocation to the smaller of the per-PDF cap and remaining corpus page budget, then stops parsing once total pages are exhausted. Reports include configured aggregate limits, bytes/pages/tokens processed, token-budget page exclusions, and documents skipped with explicit reasons.
- File size is now charged against the aggregate budget before extraction, so parse/signature failures cannot repeatedly reuse the same remaining bytes. The report calls this `bytesCountedAgainstBudget`; it may conservatively include a file later rejected by the parser before all bytes are read.
- Per-document page counters now reflect pages actually admitted to the plan, including the distinction between normal quality exclusions and token-budget exclusions; they no longer label an over-budget `usable` page as accepted.
- README planner instructions now describe aggregate limits and this is still strictly a text-extraction/chunk-plan dry run: it makes no embedding or vector writes.
- Implementation caveat: documents are selected by sorted path before aggregate budgets apply. A large early file can consume budget or be skipped while a later smaller one might fit; the output is deterministic but not a size-optimized or representative sample. Sampling beginning/middle/end pages and structure-aware sections remain future work.

- **Latest verification:** the 1-document/2-page sample processed 6,541,473 bytes within explicitly supplied 10 MiB/2-page corpus ceilings. It accepted one page and skipped one, planning one 68-token chunk without embedding or vector writes. API typecheck and diff whitespace validation passed.
- **Token-budget verification:** same bounded sample with `--max-total-tokens 100` retained the 68-token page; at 50 tokens it emitted zero chunks, marked the usable page as skipped by token budget, and reported zero estimated tokens. Both reports are under `/tmp`; no corpus/index writes occurred.

### Duplicate chat history removed from the LLM prompt

- `Backend/src/Services/ChatWithLLM.ts` previously inserted conversation history twice for each request: it formatted history into the current user prompt and also appended those same `BaseMessage`s as prior messages in the model input.
- Removed the formatted duplicate block. Prior turns continue to be sent in their structured message roles, preserving sequence while reducing repeated prompt content. The current request, retrieved evidence, and citation policy remain in the prompt.
- This is a source-level reduction in duplicated input tokens; no provider token-count or latency benchmark was run, so do not claim a measured speedup.
- Validation: `CI=true pnpm typecheck:api && git diff --check` passed (host Node 26.5 engine warning).

### Hybrid RRF duplicate-passage identity

- `Backend/src/Services/Retrival.ts` now constructs RRF identity in this order: shared source + page + passage hash, then explicit `chunkId`/`chunk_id` or provider-specific metadata/document IDs plus passage hash, then passage hash alone.
- This handles a dense and lexical copy of the same passage even when both stores supply different chunk IDs. Content hash remains in the identity, so different passages from the same page stay separate.
- This should prevent duplicate evidence from consuming multiple context slots when retrievers disagree on IDs. No labeled retrieval set is available, so the relevance impact remains unmeasured.
- `CI=true pnpm typecheck:api && git diff --check` passed.

### Official MOSDAC RSS feed discovery

- The official MOSDAC [RSS feed listing](https://mosdac.gov.in/rss-feed) publishes five product feeds: ISROCast, INSAT3D Imager/Sounder, and INSAT3DR Imager/Sounder. The crawler previously rejected `.xml` links in its candidate URL policy, so following the RSS listing could not discover the XML feeds.
- Added `xml` to the exact-host candidate extension allowlist and added all five published feed URLs to `MOSDAC_SEEDS`, while retaining the listing page. This supports direct crawling even if listing-page markup changes, with the existing robots check and request budget still in force.
- Dry-run confirms the eight default seeds and no network requests. API typecheck passed.
- Bounded live verification (`--max-requests 5 --max-depth 1 --seed-url https://mosdac.gov.in/rss-feed`) could not fetch the page/robots policy from this environment (`fetch failed`); it recorded one failed seed and made zero requests. Elevated retry had the same outcome. No remote content was saved. The other four feed endpoints remain unvalidated live; retry when MOSDAC is reachable.

### API graceful shutdown

- `Backend/src/Services/initializeChatService.ts` now exports `closeChatService()`. It waits for any in-flight initialization to settle, clears service references, closes MongoDB and Neo4j clients, and reports a clean error if either close fails.
- `Backend/src/index.ts` handles `SIGINT` and `SIGTERM` once, stops accepting new requests, closes idle connections, drains active requests, then closes chat-service connections. A 10-second deadline forces exit if the drain hangs; failures set a non-zero exit code.
- README documents signal behavior and the deadline. No readiness endpoint or eager provider checks were added; `/healthz` remains liveness because providers initialize lazily.
- Validation: `CI=true pnpm typecheck:api && git diff --check` passed. No signal integration test or provider connection was run.

### Human-readable PDF quality review samples

- `Backend/src/ingestion/inspectCorpus.ts` now supports opt-in `--include-page-text-samples`, adding each sampled page's quality status, score, signals, a 1,000-character excerpt, and a truncation flag. The default report remains metadata-only; the excerpt mode is explicit because reports contain document text.
- README documents a small review-bundle invocation and warns that it carries source text. Output remains exclusive-create and read-only with respect to the corpus.
- Bounded inspection of one PDF / two pages produced a review bundle under `/tmp/astrolynx-pdf-review-sample.json`: page 1 was `review`, score 1.0, with extracted text “SA tellite based M arine process...” showing spacing defects; page 2 was `usable`, score 1.0. This is one document sample, not a labeled evaluation and not enough evidence to adjust thresholds.
- API typecheck and `git diff --check` passed. No embedding/index write occurred.

### Duplicate PDF content skipped in chunk plans

- The existing corpus manifest identifies seven exact duplicate hash groups (14 files). `Backend/src/ingestion/planPdfChunks.ts` now uses the parser's full-file SHA-256 to retain the first sorted path as canonical and marks later copies `duplicate_pdf_content` with `duplicateOf`, size/page metadata, and zero chunks. Source files are untouched.
- `extractPdfPages` now offers a callback immediately after bounded read, PDF signature validation, and SHA-256 hashing, but before `pdf-parse` page extraction. The planner uses it to skip parsing later copies and records their canonical file path. Duplicate bytes still count against the aggregate limit because each copy must be read to establish its hash.
- Full bounded dry-run over all 56 PDFs (up to 8 pages each, 500 unique parsed-page ceiling, 1 GiB bytes, 200,000 estimated tokens) completed with 0 parse failures. It reported 7 duplicate copies skipped before page parsing, 368 unique pages parsed, 332,528,909 bytes counted, 293 unique usable pages accepted, 75 pages skipped by quality, 346 chunks, and 157,575 estimated tokens.
- Built `/tmp/astrolynx-bm25-dedup-full-v2.json` from that plan: 346 chunks, 757,523 bytes, stable corpus version, and no embeddings/Pinecone writes. The builder's uniqueness checks passed, showing the previously known duplicate chunk-ID failure is avoided.
- Both artifacts are under `/tmp`; these first-eight-pages-per-PDF outputs are a planning/wiring check only, not a calibrated or approved production corpus.

### Chunk-plan provenance validation before BM25 sidecar creation

- The planner now records `acceptedPageNumbers` per source document.
- `Backend/src/ingestion/buildLexicalIndex.ts` requires the current `page-text-quality-v2` report, validates source/page membership for every chunk, and recomputes each chunk ID from the source hash, page number, chunk number, and text before constructing a sidecar. Missing/stale policy metadata or a chunk page outside the accepted page list fails closed.
- Full current corpus dry-run output `/tmp/astrolynx-pdf-chunk-plan-validated.json` passed the stricter builder, yielding a 346-chunk/757,519-byte BM25 sidecar at `/tmp/astrolynx-bm25-validated.json`; no embeddings or vector-store writes occurred. This validates the current producer/consumer contract, not the quality of the heuristic labels or retrieval quality.

### API request rate limits

- Added `express-rate-limit@^8.7.1` to the API. Chat routes default to 20 requests/minute/IP; session creation/history default to 120 requests/minute/IP. `429` responses use the API's `{ error }` shape, standard draft-8 rate-limit headers, and no legacy `X-RateLimit-*` headers. `/healthz` is outside the limiters.
- Added validated settings for rate-limit window and per-route maxima. `TRUST_PROXY_HOPS` defaults to `0`; deployments must set the exact number of trusted proxy hops or the limiter will safely group traffic at the proxy IP rather than trust forwarded headers.
- The package's built-in store is process-local and resets on restart; multi-instance deployments need a shared store adapter. Rate limits are abuse/cost controls, not user authentication.
- Validation: `CI=true pnpm typecheck:api` and `CI=true pnpm build:api && git diff --check` passed after relinking the workspace from the existing pnpm store. No runtime 429 integration check was run.

### 1. Repository and architecture inventory

- Confirmed there were two independently configured applications rather than a root workspace:
  - Backend: `Backend/`, Express + TypeScript, npm lockfile, scripts in `Backend/package.json`.
  - Frontend: `astrolynx-chatbot Frontend/`, Next.js + TypeScript, pnpm lockfile. This corrects the first-pass inventory note that the frontend lockfile was not found; it is `astrolynx-chatbot Frontend/pnpm-lock.yaml`.
- Confirmed the README is stale in at least one important way: it instructs users to enter a `Frontend/` folder, while the actual directory is `astrolynx-chatbot Frontend/`. It also describes Neo4j, Pinecone, MongoDB, Ollama, Gemini, and Sarvam as required without a reliable current setup path.
- No `AGENTS.md` or repository-local implementation instructions were found in the initial `rg --files` scan.
- The API currently exposes:
  - `GET /api/session` to generate a UUID session ID (it does not persist a separate session record).
  - `GET /api/session/history/:sessionId` to read LangChain message history from MongoDB.
  - `POST /api/chat` and `POST /api/chat/image`, both routed to the same chat handler.
- `POST /api/chat` currently accepts `message`, `sessionId`, optional `imageData`, `isAudioMode`, and `targetLanguage`; it checks only that `message` is truthy, logs request content/metadata, and returns `{ aiMessage, sessionId }`. Citation data is not part of the observed response contract.
- The frontend chat component hardcodes `http://localhost:5000`, calls these endpoints, and carries audio/image/language paths. This is migration inventory only; those flows need product-scope decisions before being retained.

### 2. Ingestion and corpus findings

- `Backend/src/utils/Crawl/advancedCrawler.ts` starts a crawl immediately when imported. Its configuration sets:
  - start URL `https://www.mosdac.gov.in/sitemap`;
  - depth 3, 20 concurrent requests, 500 URL budget, 300 ms interval, and 30-second fetch timeout;
  - an extension-based filter and `hostname.includes("mosdac.gov.in")`, which is not an exact-host check;
  - `normalizeUrl()` drops every query string, which can collapse distinct catalog records;
  - it fetches pages through `simplecrawler`, then calls `crawlPage(url)` from `documentParser.ts`, which issues a second HTTP request to extract page content and links;
  - it stores all collected text in memory and exports a combined PDF when done; it does not create a structured per-document quality report or persistent restart state.
- `Backend/src/utils/Crawl/documentParser.ts` downloads documents to timestamped temporary filenames and uses `pdf-parse`, Mammoth, or XLSX. It buffers a whole PDF into memory, has no content signature validation, checksum, atomic download, or page-level quality score. Download size is checked only after the transfer finishes. The crawler passes a configured max parse size of zero, so PDFs are saved without text parsing in that path.
- `Backend/src/data_saver.ts` scans `Backend/mosac-data`, loads PDFs with `PDFLoader`, splits them into 1,000-character chunks with 200-character overlap, initializes Ollama embeddings and Pinecone, and currently has `pineStore.addDocuments` commented out. There is no quality gate or stable idempotency key.
- `Backend/src/kg_saver.ts` extracts graph documents from PDFs and embeds each graph node sequentially before writing to Neo4j. It has no extraction-quality filter, checkpoints, idempotent upsert policy, or per-page provenance policy visible in the inspected code.
- Generated [`docs/corpus_inventory.json`](./docs/corpus_inventory.json), a read-only manifest of 56 files with relative path, byte size, SHA-256, and `%PDF-` signature result. It reports 56 valid PDF signatures, 332,528,909 bytes total, and seven duplicate hash groups (14 files in exact duplicate pairs). The pairs are: `10-1752058902635.pdf` / `2596-1752019395860.pdf`; `13-1752058897318.pdf` / `2599-1752019372078.pdf`; `INSAT_3D_ATBD_MAY_2015-1752019403927.pdf` / `INSAT_3D_ATBD_MAY_2015-1752238816397.pdf`; `INSAT_Product_Version_information_V01-1752238722925.pdf` / `INSAT_Product_Version_information_V01-1752238808359.pdf`; `Incremental-ATBD-12Feb2020-1752019399297.pdf` / `Incremental-ATBD-12Feb2020-1752238813856.pdf`; `SALP-MU-M-OP-15984-CN_0102%5B1%5D_handbook-1752019401882.pdf` / `SALP-MU-M-OP-15984-CN_0102%5B1%5D_handbook-1752238816256.pdf`; `scatsat_level4_dataproducts-1752237925537.pdf` / `scatsat_level4_dataproducts-1752238809642.pdf` (all under `Backend/downloaded_docs/`). No files were removed. The manifest generation timestamp is metadata, not a document modification time.

### 3. Retrieval, persistence, and runtime findings

- At initial inspection, `Backend/src/Services/initializeChatService.ts` eagerly required MongoDB, Gemini, Pinecone, Ollama embeddings, and Neo4j during import-time startup. Import-time initialization and mandatory Neo4j have since been removed; the chat request still initializes the legacy MongoDB, Gemini, Pinecone, and Ollama stack.
- `Backend/src/Services/Memory.ts` uses `BufferWindowMemory` with a ten-message window and MongoDB chat history. History retrieval maps all message timestamps from the parent Mongo document’s ObjectId timestamp, so messages in one stored document may share a timestamp.
- At initial inspection, `Backend/src/Services/Retrival.ts` performed LLM query transformation with 3–5 rewrites plus a hypothetical document, Pinecone fan-out, RRF, and Neo4j semantic retrieval. Current default path uses the original query and one vector request; LLM query rewrite/classification calls are removed, Neo4j is disabled by default, and untraceable/low-quality candidates are screened before context assembly. This remains legacy Pinecone retrieval, not the planned hybrid retriever.
- `Backend/src/Services/main.ts` starts service initialization as an import side effect and exits the process on failure. It builds LangGraph state, retrieves memory, invokes the graph, then saves chat history; it also looks up the saved AI message by content after saving, which can be ambiguous for repeated responses.
- `Backend/src/index.ts` enables open CORS and accepts JSON bodies up to 50 MB. It reads `PORT` without a default/validation and does not expose observed health/readiness or graceful shutdown handlers.
- `Backend/src/utils/Config.ts` casts environment variables to strings without validating presence or format. The backend `.env.example` contains names but not a documented required/optional classification.
- Existing Docker Compose starts `ollama/ollama:latest` and a persistent model volume; it does not pin an image version or provision the model in an explicit reproducible step.
- There are no meaningful project test scripts in the backend (`npm test` is a placeholder failure); no tests or builds were run during this inventory.

### 4. End-to-end chat flow traced (initial behavior before this pass)

The initial graph path in `Backend/src/Services/LangGraphChain.ts` behaved as follows; the query fan-out, classifier call, Neo4j default, context assembly, and citation behavior have since been revised as recorded below:

1. A non-English `targetLanguage` translates the incoming question to English first. Translation failures log and continue with the original text.
2. An LLM classifier chooses `greeting`, `other`, or `mosdac`. Greetings and `other` go through a separate LLM response path; only `mosdac` runs retrieval. This classification is a model call before retrieval and may misroute domain questions.
3. MOSDAC requests call `queryTransformation`, which asks the LLM for 3–5 alternate queries plus a hypothetical answer. That hypothetical text is added as another vector query. `parallelRetrieval` searches Pinecone top 5 for each query concurrently.
4. `retrieveFromNeo4j` runs in parallel with the Pinecone path. It embeds the question, gets up to five nodes, then makes a separate relation query for each node (N+1 database round trips).
5. `buildContext` concatenates Pinecone text and Neo4j relations. It truncates by estimating a character ratio from token count, which may cut passages mid-sentence and does not preserve source boundaries in the prompt.
6. The model generates an answer. A non-English target triggers output translation. Audio mode then calls Sarvam TTS and returns base64 audio.
7. `main.ts` saves the question and answer in Mongo history but returns no source citations. `Memory.ts` stores/retrieves only conversational message history, not evidence/citation records.

The rewrite should keep the useful user-visible behaviors only after scope decisions, but change the default path to: validated request → bounded history → one retrieval operation → optional rerank → evidence-bounded answer → citation objects from the exact context → persist messages and citations. Language and audio should be explicit capabilities with verified supported locale mappings, not hidden branches that silently continue after translation failure.

Frontend observations in `astrolynx-chatbot Frontend/components/chat-interface.tsx`:

- On load, the component reads `chatSessionId` from local storage, fetches history if present, or calls `GET /api/session` and stores the returned ID.
- Text/image messages are sent to `POST /api/chat`. Audio-transcribed messages use the same endpoint with `isAudioMode: true` and `targetLanguage`.
- The response is expected as `data.aiMessage`; history messages are expected to have `id`, `content`, `role`, and `timestamp`.
- UI language options currently include English, Spanish, French, Hindi, Hinglish, and German, while the rewrite plan only promises verified English/Hindi. Their actual backend translation support must be checked before keeping these choices.
- Browser speech recognition is used for voice input, an image is serialized into the request body, and TTS is played from base64 audio. Those flows need explicit size, privacy, locale, and first-release scope decisions.
- New chat clears the one local-storage session ID and local UI state before requesting another session. The backend `message` truthiness check means image-only requests are rejected even though the UI enables image-only sending. File upload has no visible size/dimension/type enforcement beyond the browser `accept="image/*"` hint.

## Migration inventory (initial)

| Area | Observed current behavior | Rewrite disposition | Data-loss / migration note |
| --- | --- | --- | --- |
| `Backend/src/Controllers`, `Routes` | Minimal Express routes; weak request validation; chat contract omits citations | Replace with validated API modules and shared schemas | Preserve endpoint compatibility only where UI still needs it |
| `Backend/src/Services/LangGraphChain.ts`, `main.ts` | LangGraph orchestration plus import-time service initialization | Replace with bounded orchestration; retain LangGraph only if real branching/checkpoint needs survive review | Avoid connecting external services during module import |
| `Backend/src/Services/Retrival.ts` | Pinecone fan-out, HyDE, RRF, and Neo4j retrieval | Replace with one evidence-returning retrieval pipeline; measured hybrid retrieval | Existing indexes may contain useful data; inspect before changing/deleting |
| `Backend/src/Services/Memory.ts`, Mongo history | LangChain Mongo history and bounded memory | Replace with explicit session/message persistence contract | Do not drop/rename collections until backup and mapping exist |
| `Backend/src/utils/Crawl/*` | Import-side-effect crawl, permissive domain match, second page fetch, weak download validation | Replace with resumable bounded MOSDAC adapters and staged processing | Keep raw PDFs/HTML as inputs; no mass recrawl before quality report |
| `Backend/src/data_saver.ts`, `kg_saver.ts` | Separate PDF-to-vector and PDF-to-graph jobs; low provenance/quality controls | Replace with one inspectable extraction/chunk/index job; graph optional | Current Pinecone/Neo4j contents have not been inspected |
| `Backend/downloaded_docs/`, `Backend/mosac-data/` | Existing local PDF corpora, provenance not yet audited | Preserve; generate inventory/manifest and quality sample before reuse | Never delete or overwrite these folders during rewrite setup |
| `astrolynx-chatbot Frontend/` | Next.js chat plus data/map and voice-related UI; chat API hardcoded | Keep as UI reference; migrate chat to typed API; remove/defer inert features after UI audit | Preserve useful styling and user-visible chat flows |
| `references/` | Four cloned MOSDAC/ISRO RAG examples | Read-only implementation references | Do not include in production build context or rewrite index |

## Decisions currently made by the plan

These are the working defaults in `REWRITE_PLAN.md`; revisit only if implementation evidence demands a change.

- Focus first release on grounded chat, citations, session history, and verified English/Hindi behavior.
- Use a modular monolith and avoid microservices.
- Keep source artifacts and processing stages separate; never embed low-quality text.
- Keep MOSDAC documentation/catalog ingestion separate from authenticated granule downloads.
- Prefer static HTTP crawling and use browser rendering only for identified JavaScript-dependent pages.
- Use hybrid lexical + dense retrieval with measured rank fusion/reranking, and reuse one candidate set for both answer context and citations.
- Require a MOSDAC gold evaluation set and p50/p95 latency/cost measurements before claiming accuracy or speed improvements.

## Phase 1 work completed so far (acceptance criteria remain open)

- Added root `package.json` with workspace scripts for API/web dev, build, typecheck, and PDF inspection. Added `pnpm-workspace.yaml` for the existing `Backend/` and `astrolynx-chatbot Frontend/` directories; no directory rename was made.
- Renamed workspace package IDs to `astrolynx-api` and `astrolynx-web` so root scripts can target each app explicitly. Their runtime/dependency versions were not otherwise changed.
- Added `.nvmrc` set to Node 24. Node 24 is an LTS line and supports the selected pnpm 11 toolchain; Node 26 was Current at the time of this setup, so it is not the baseline for reproducible installs. Source: [official Node release schedule](https://nodejs.org/en/about/previous-releases/).
- Pinned root package manager metadata to the locally available pnpm 11.5.3. Added the generated root `pnpm-lock.yaml` resolving both apps (947 package resolutions). The root install completed after reviewing and explicitly allowing `sharp` and `protobufjs` build scripts. The old `Backend/package-lock.json` and `astrolynx-chatbot Frontend/pnpm-lock.yaml` were removed after root install/build validation; root lockfile is authoritative.
- Added ignores for the local pnpm store, backend build output, and Next build output. The pnpm lock generation created a small `.pnpm-store/` metadata directory; it is ignored and contains no downloaded dependency payloads.
- pnpm emitted deprecation warnings for `next@15.2.4`, `@langchain/community`, `@types/mongodb`, `recharts`, and deprecated transitive dependencies, plus peer dependency warnings. The manifest still has `latest` ranges for `@emotion/is-prop-valid` and `framer-motion`. This is evidence for the planned dependency review, not authorization to do a broad package upgrade before checking compatibility.
- Host toolchain is Node `v26.5.0` with pnpm `11.5.3`; pnpm correctly warns that the host Node does not match the new Node 24 project pin. Node 24 must be used before clean-install/build validation.
- Removed `typescript.ignoreBuildErrors` from `astrolynx-chatbot Frontend/next.config.mjs` after a frontend TypeScript check passed. The frontend production build initially failed because `next/font/google` needed network access to `fonts.googleapis.com`; removed that fetch and used system `font-sans`, and moved the favicon into Next metadata. This makes the build independent of Google Fonts access. `eslint.ignoreDuringBuilds` remains because lint configuration/tooling has not yet been set up.
- Added direct `cheerio` dependency to Backend because the legacy crawler imports it but pnpm's isolated dependency layout exposed that it was only available transitively. Replaced the direct `uuid` import with Node's built-in `crypto.randomUUID()` and changed old splitter imports to LangChain's `langchain/text_splitter` export, avoiding an undeclared splitter package dependency.
- Added `Backend/src/config/env.ts` using Zod 3. It validates port, CORS origin URLs, Ollama URL, provider configuration groups, browser executable path, and the explicit `ENABLE_LEGACY_GRAPH_RETRIEVAL` boolean. Blank optional `.env` values normalize to unset. `Backend/src/utils/Config.ts` reads validated settings. `Backend/src/index.ts` defaults to port 5000 and restricts CORS to configured origins. Chat still initializes MongoDB, Gemini, Pinecone, and Ollama together; Neo4j is optional and disabled by default. Per-capability provider lifecycle remains unfinished.
- Build evidence: API and frontend type checks passed; `CI=true pnpm build` passed API compilation and the Next.js 15.2.4 production build. The build reports “Skipping linting” because the existing lint bypass remains configured. Initial build attempts exposed an incorrect frontend working directory and the Google Fonts network dependency; both were corrected and the final root build passed.

## Ingestion implementation started

- Added `Backend/src/ingestion/textQuality.ts`: page-level signals for empty/short text, replacement glyphs, controls, Unicode private-use glyphs, symbol density, word-like token density, repeated lines, and repeated-character runs. Output includes a versioned status, heuristic score, metrics, and evidence signals. It is not a calibrated probability. Short content and symbol-heavy pages route to review rather than being rejected on a simple alphanumeric ratio. Policy is now v2: common dot/dash/underscore/equal leader runs are ignored because PDF contents pages use these as layout.
- Added `Backend/src/ingestion/pdfPages.ts`: single-pass bounded PDF text extraction via pdf-parse/pdf.js, `%PDF-` signature and file-size/page-count checks, retained page numbers, no-text-layer records for later OCR routing, and attached quality decisions. It does not OCR, chunk, embed, or persist data.
- Added `Backend/src/ingestion/inspectPdf.ts` and `ingest:inspect-pdf`. Its inspect-only JSON report includes quality counts and a few clipped page samples; defaults are 500 pages and 50 MiB. It reports `embedded: false`.
- Added `Backend/src/ingestion/inspectCorpus.ts` and root/backend `ingest:inspect-corpus` scripts. It scans the two known local PDF directories, processes files sequentially, caps documents/pages/file/bytes, reports per-file quality and failures without printing page text, and only writes a report when `--output` is supplied. Output creation uses exclusive mode and will not overwrite an existing file. It never chunks or embeds.
- Inspected `Backend/downloaded_docs/10-1752058902635.pdf` (38 pages, 6.54 MB) with a 12-page cap: 8 usable, 3 review, 1 reject, including one no-text-layer page. It contained private-use bullet glyphs on a readable contents page. The initial scorer rejected it despite a reasonable score; the rule was corrected so private-use glyphs route to review unless the page is overwhelmingly private-use with little word-like text. It now classifies that page as review. pdf.js emitted `Warning: TT: undefined function: 22`; alternate extraction/OCR handling remains unimplemented.
- Scorer thresholds are **not approved for bulk ingestion**. Compare with labeled good/bad pages across all corpus sources first. Current extraction does not yet run a second parser or OCR.

### Corpus quality sample

- Created `docs/pdf_sample_quality.json` by running the compiled inspector on the first eight pages of all 56 inventoried PDFs (423 pages actually sampled; no corpus file writes). It records per-file checksums, page counts, statuses, no-text page numbers, and signal counts without embedding the extracted text.
- Under policy v1, the sample classified 275 usable, 116 review, and 32 reject/no-text pages. Reviewing flagged samples showed dotted table-of-contents leaders were causing false `long_repeated_character_run` warnings on readable technical manuals (for example the sampled INSAT-3D ATBD and incremental ATBD). Policy v2 ignores common layout leader characters. The same sample under v2 classifies 325 usable, 66 review, and 32 reject/no-text; `long_repeated_character_run` fell from 51 occurrences to 1. The reject/no-text count did not change.
- This first-eight-page sample is not representative of all pages: scanned appendices and later document sections may differ. The two identical document pairs are represented as separate files. The report purpose says explicitly that these are provisional heuristic decisions, not bulk-ingestion approval. Next: manually inspect representative usable/review/reject pages, extend sample across page positions (beginning/middle/end), and label examples before deciding thresholds or parser fallback.
- pdf.js continues to emit `TT: undefined function: 22/23/32` warnings for some font glyph mappings. That is a targeted second-parser candidate; warnings alone do not prove the extracted page is unusable.

### MOSDAC crawler implementation and sample findings

- Added `Backend/src/ingestion/mosdacUrlPolicy.ts`, `politeHttp.ts`, `htmlExtractor.ts`, `mosdacCrawler.ts`, and `runMosdacCrawl.ts`; added `ingest:crawl-mosdac` scripts. The crawler starts with public satellite/radar catalog and RSS pages, uses exact MOSDAC host policy, checks `robots.txt`, limits redirects, bounds response sizes/timeouts/retries, enforces a minimum one-second per-host delay, saves files atomically, and persists queue/visited/failure/ETag state. Its default is a no-network dry run; `--execute` opts into fetching. Defaults cap at 100 requests and depth 2 (hard caps 1,000 requests and depth 5). PDFs are signature-checked and saved with `embedded: false`; no embedding or index write is implemented.
- The parser removes common page chrome and extracts headings, paragraphs, lists, table rows, feed entries, links, titles, and document URLs. It preserves header/aria-hidden wrappers that contain content tables and falls back to body text when semantic blocks are nearly empty. Raw HTML/XML is retained alongside JSON records; IDs are stable SHA-256 URL prefixes.
- HTML and feed JSON records now carry `textQuality` from the shared v2 page-text assessor, plus `extractionPolicyVersion: mosdac-static-html-v1`. This makes extraction quality visible in the crawl artifact; it is not an indexing approval, and no chunk/embed stage consumes it yet.
- Redirect handling now checks each page redirect against exact-host policy, rejects cross-host redirects, and verifies the redirected path against the already loaded host `robots.txt` rules before following it. Policy/URL rejections are marked non-retryable so they do not repeat the same request. This avoids using an allowed entry URL to reach a disallowed path and avoids wasted retries.
- A bounded authorized sample ran with `--execute --max-requests 3 --max-depth 0` into `/tmp/astrolynx-mosdac-crawl-check`. Two HTML pages (radar catalog and RSS landing page) were saved; no PDFs/feeds were discovered at depth 0. The satellite seed returned a transient `fetch failed` and is recorded in persistent state. The summary now reports `failedTotal` as well as `failuresThisRun`.
- The sample exposed `{{$index + 1}}`, `{{allproduct.name}}`, etc. in the radar response. This is an Angular-rendered application shell rather than usable product rows. `htmlExtractor.ts` now detects unresolved template bindings and Angular markers, marks such pages `needs_browser_render`, and attaches explicit `extractionSignals`. Offline extraction against the saved page confirmed `needs_browser_render` with `unresolved_template_bindings` and `javascript_application_markers`.
- The initial RSS landing-page sample exposed five official XML feed links (`isrocast.xml`, `3dimager.xml`, `3dsounder.xml`, `3drimager.xml`, `3drsounder.xml`). Depth 0 intentionally did not request them; a later one-request ISROCast XML crawl and structured-entry extraction are documented under “Structured MOSDAC catalog and feed extraction.”
- Added direct `playwright@^1.64.0` to the API workspace. The first add attempt surfaced `ERR_PNPM_UNEXPECTED_STORE` because existing links used `/Users/raven/Library/pnpm/store/v11` while default pnpm selected the workspace store. Retried with the explicit existing store path after approval; `CI=true pnpm install --frozen-lockfile --store-dir /Users/raven/Library/pnpm/store/v11` completed from cache and ran the reviewed `sharp`/`protobufjs` scripts. No browser binary was downloaded; the live check used system Chrome via `MOSDAC_BROWSER_EXECUTABLE_PATH`.
- Added `mosdacBrowserRenderer.ts` and opt-in `--render-js`. Rendering runs only after static extraction marks a page `needs_browser_render`; default crawl remains static. It is capped at three pages/run (hard max ten), 40 same-host requests/page, and 45 seconds/page; serializes requests using the maximum of CLI delay and robots delay; and blocks images/media/fonts, non-HTTPS, cross-host, and robots-disallowed requests. Original and rendered HTML are saved separately. Records include rendered URL/hash/status/error/request count. Browser subrequests are separately counted and capped from top-level `maxRequests`.
- A live one-page radar catalog run made one top-level request and 37 same-host browser requests. It saved original and rendered HTML without crawl failures. The rendered DOM exposed a table header and `No data available in table`; initial extraction missed it because it was inside hidden wrappers. After preserving content-bearing wrappers and using a low-content fallback, offline re-extraction returns 180 characters of headers/empty-state text with status `static_html_extracted` and quality `review`. The page rendered successfully but MOSDAC returned no catalog records in that response; this is not evidence of catalog acquisition.
- All crawl sample data is under `/tmp`; existing corpus PDFs were not changed. A generic typed satellite/radar table adapter now exists, but it is only validated on the radar page and no satellite catalog rows were observed. HTML/feed quality is recorded but not calibrated or used as an indexing gate. Empty/short catalog pages remain review/reject, and no product rows are invented.

### Structured MOSDAC catalog and feed extraction

- Added `Backend/src/ingestion/mosdacCatalog.ts`. It identifies satellite/radar catalog URLs, recognizes product table headers, maps known fields into a typed row shape, and reports `catalog_rows_extracted`, `catalog_empty`, `catalog_schema_unrecognized`, or `not_catalog_page`. Rows that are blank, loading/empty-state text, or unresolved template bindings are ignored and counted; `catalog` is attached to crawl JSON records.
- Offline parser checks against the original static radar HTML (Angular bindings) and rendered radar HTML both report zero product rows. Static capture reports the template signal; rendered capture reports a recognized nine-column header plus one ignored empty-state row. This avoids treating empty-state text or Angular `{{...}}` values as satellite product metadata.
- Fetched `https://mosdac.gov.in/isrocast.xml` under a one-request authorized budget into `/tmp/astrolynx-mosdac-feed-check`. The saved XML contains 25 ISROCast entries and replays through `extractXmlFeed` into typed title, description, publication time, acquisition start, product filename, and preview URL values. The old JSON record from that earlier crawl lacked `feedEntries`; do not cite that artifact as proof of structured persistence. A later live crawl using the current implementation verified the network-to-record path and wrote all 25 entries. The adapter assigns deterministic entry IDs, leaves `url` null when the only item link is a preview image, retains preview metadata, and excludes preview image URLs from crawl discovery.
- The feed text quality heuristic flagged repeated-line noise, expected with repeated product titles. Structured entry metadata is the preferred representation for feed use; feed-level flat text must not be treated as a single clean document or embedded wholesale. Per-entry quality review and durable store-level deduplication remain outstanding.
- Stable per-entry IDs prefer a non-preview URL when present, otherwise product filename plus acquisition start; only entries without either use title/date/description fields. Display title/description changes therefore update the existing product record instead of creating a new identity. Current ISROCast items expose JPG links and product filenames as metadata, not direct granule URLs, so the adapter deliberately does not invent a downloadable product URL.
- Added `Backend/src/ingestion/feedEntryStore.ts`, integrated into successful XML feed crawls. It writes per-feed manifests and per-entry JSON records under `feeds/<sha256-feed-url>/`, atomically upserts by stable entry ID, refreshes first/last-seen metadata, and marks disappeared entries inactive without deleting their records. It refuses empty snapshots; the crawler also skips reconciliation for malformed/truncated XML. A failed record-store write leaves ETag/Last-Modified validators unchanged, so retry is not converted into a 304 that would skip persistence.
- Crawl summary now reports created, changed, unchanged, and deactivated feed entries plus snapshots skipped from reconciliation. Reconciliation uses only a complete non-empty XML snapshot, preventing empty or malformed feed responses from deactivating the whole stored catalog.
- Offline saved-feed persistence replay under `/tmp/astrolynx-feed-entry-store-smoke-v2`: first 25-entry snapshot created 25; changing a title and description updated one existing identity and left 24 unchanged; the following 24-entry snapshot marked one inactive. Source feed XML was read-only; generated JSON is confined to `/tmp`.
- Authorized live `isrocast.xml` crawl under one top-level request into `/tmp/astrolynx-mosdac-feed-entry-crawl` — 25 new per-entry records, 1 feed record, 0 failures on the successful run. The earlier sandbox attempt's robots failure remained in persisted failure history; after adding stale-failure clearing, a second one-request live refresh returned 25 unchanged entry records and `failedTotal: 0`. The saved parent record contains 25 entries; the feed manifest contains 25 active IDs; the state file contains zero failures. MOSDAC returned 29,365 bytes; no granules/previews were downloaded.
- The live sample revealed and fixed stale crawl failure bookkeeping: when a queued URL later completes successfully (including HTTP 304), its prior failure record is removed. Robots-disallowed and terminal unsupported-content outcomes clear stale failure records too. On an error during feed persistence, validators are now committed only after successful processing, allowing retry instead of incorrectly receiving/skipping on 304.
- The official satellite catalog was rendered under a one-page cap. It made 12 browser requests and returned table headers plus `No products available for selected Product & Sensor.` There were zero catalog rows. Its current compound header (`Product Name/Acq Calendar/Version`) was not recognized at first; the adapter now accepts it, and replaying saved rendered HTML reports `catalog_empty`, the seven headers, and zero invented rows. A short empty catalog response remains `review` under general page-quality scoring and is not an index candidate.
- Browser page navigation/rendering is bounded to 45 seconds, 40 same-host requests, and four in-flight requests. The renderer counts aggregate encoded response bytes from Chromium DevTools `Network.dataReceived` events and closes the browser context using an internal cancellation trigger below the configured `--max-render-bytes` cap (20 MiB default, hard maximum 100 MiB). It accounts for declared lengths of pending responses before their bodies complete and reserves up to 128 KiB (or half of a smaller budget) to absorb in-flight data. It also checks final HTML against the configured size limit. Unknown-length responses can still overshoot; this is a guarded cap, not a strict network firewall.
- Authorized live one-page radar render with the default 20 MiB budget: 1 top-level request, 37 browser requests, 505,721 encoded response bytes, 343,382-byte rendered DOM, successful render, and no crawler failures. Per-page record contains the same encoded byte count. This confirms real traffic is counted below the threshold.
- First one-page low-budget check at a 250,000-byte trigger stopped at 325,059 bytes (75,059 over) because response data for many already-started requests arrived before the context closed. Closing the whole context and limiting four in-flight requests alone did not reduce that sample's reported bytes.
- Added early accounting from declared `Content-Length` response headers and a cancellation reserve below the configured cap. The repeated 250,000-byte check then stopped at 150,237 encoded bytes: internal trigger 125,000, configured cap 250,000. It recorded 34 browser requests, one render failure, the precise trigger reason, and retained the original static HTML record; no rendered HTML was saved. This live sample stayed below the configured cap, but unknown-length responses can still exceed it. The sample demonstrates reduced overshoot, not proof of a strict cap for all MOSDAC response patterns.

### PDF chunk planning dry run

- Added `Backend/src/ingestion/planPdfChunks.ts`, exposed by root and API `ingest:plan-pdf-chunks` scripts. It processes a bounded selection of local PDFs sequentially, uses the shared page extractor and only chunks pages currently marked `usable`. Pages marked `review`, `reject`, or `no_text_layer` are excluded and counted. The quality gate is explicitly provisional pending labeled-page calibration.
- Chunks retain line breaks and page boundaries, target a configurable character budget (default 3,500), and use bounded character overlap (default 350). Each chunk carries a SHA-256 document content ID, page number, per-page chunk number, and SHA-256 chunk ID. The document hash is computed from the already-loaded source buffer by the PDF extractor, avoiding a second whole-file read. Token volume is estimated as `ceil(characters / 4)` and labeled as an estimate, not provider usage.
- The report includes document/page/chunk totals, truncation and failure status, and chunk text for human review. Defaults select five documents and eight pages per document; hard caps are 100 documents, 500 pages/document, and 500 MiB/document. `--output` creates directories as needed but opens the report with exclusive `wx`, so it cannot silently overwrite a prior review artifact. No embedding or vector-store write exists in this path.
- Sample command `CI=true pnpm ingest:plan-pdf-chunks -- --max-documents 1 --max-pages-per-pdf 2 --output /tmp/astrolynx-pdf-chunk-plan-check-2.json` succeeded: one document, two pages examined, one usable page accepted, one skipped, one chunk, 68 estimated tokens, zero errors. The report identifies the first PDF as 38 pages and marks it truncated at the explicit two-page limit. Output remains under `/tmp`.
- A first sample attempt supplied `Backend/downloaded_docs` from the workspace root; the pnpm package command resolves relative input directories from `Backend/`, selected zero files, and returned a valid empty report. Re-running with the default package-relative `downloaded_docs` directory exercised the intended path. Supply `--input-dir` paths relative to `Backend/` or as absolute paths.

### Legacy RAG request-path reduction and citations

- Replaced `Backend/src/Services/Retrival.ts` with a clearer bounded path. The previous query transformation asked Gemini for 3–5 rewrites plus a hypothetical answer, then ran one Pinecone query per variant; current query transformation returns the exact user query, and deterministic greeting detection avoids a classifier LLM call. Pinecone fetches up to 20 candidates, filters for non-empty source provenance and shared text-quality status `usable`, then keeps at most 8. It logs counts only, not query strings or retrieved page contents. Query fan-out is still bounded to 3 variants if later enabled, and RRF uses content-aware IDs for de-duplication.
- Neo4j is now off by default via validated `ENABLE_LEGACY_GRAPH_RETRIEVAL=false`; its old embedding + up to five sequential relation queries are skipped. Setting the flag true requires complete Neo4j configuration and re-enables the legacy graph branch. No Neo4j data was queried or modified. This is a latency-oriented default based on avoiding unmeasured extra work, not a measured benchmark proving faster end-to-end or better relevance.
- `Backend/src/Services/Memory.ts` now assembles up to six bounded, source-labeled evidence blocks, preserves page/title/source metadata, and returns citation metadata. It enforces the context token cap by dropping whole trailing passages instead of cutting them at a character ratio. `ChatWithLLM.ts` treats passages as untrusted data, asks for exact `[S#]` citations, and replaces non-abstaining uncited answers with a safe response; unknown citation IDs are stripped. `main.ts` returns citation objects and persists a source footer with the assistant message. The frontend renders citation metadata and links.
- Citation reliability depends on legacy Pinecone metadata. Candidates lacking `source`/file/url provenance are excluded. Corpus/index contents and their metadata have not been inspected, so the current client behavior has not been exercised against actual chat queries. The API still requires legacy MongoDB, Gemini, Pinecone, and Ollama and does not yet have retrieval evaluation, lexical search, reranking, or a rewritten store schema.

### API process startup adjustment

- Removed `initializeChatService()` from module-import startup in `Backend/src/Services/main.ts`. Previously, importing the chat route initialized MongoDB, Gemini, Ollama embeddings, Pinecone, Neo4j, and the graph, and exited the process on any missing/unavailable dependency. Initialization remains attempted when a chat request arrives; chat still depends on MongoDB, Gemini, Ollama, and Pinecone, while Neo4j is optional and disabled by default.
- Added `GET /healthz` in `Backend/src/index.ts` as a liveness response (`{status:"ok"}`); it intentionally does not claim provider readiness. README now documents this behavior and the remaining chat dependency.
- `initializeChatService()` now shares concurrent startup work through a single in-flight promise. On failure it clears provider globals, closes any opened MongoDB/Neo4j clients, resets the promise so a later request may retry, and rethrows the error. A failed MongoDB connect keeps its client reference until outer cleanup so a partially opened socket can be closed. This reduces duplicate connection/resource leaks but does not turn individual core providers into optional chat capabilities.
- This is a transitional startup improvement, not the planned provider lifecycle rewrite. There is no readiness endpoint, timeout/circuit breaker, independent provider capability selection, or fully tested recovery behavior yet.

### Chat request validation and payload limits

- `Backend/src/Controllers/chatController.ts` now validates JSON with Zod before entering the chat service: required UUID session ID, 8,000-character message ceiling, boolean audio flag, known current UI language codes, and optional PNG/JPEG/WebP data URL capped at 7,000,000 characters. Empty text is accepted only when an image is present, matching the UI's image-only action.
- The request body parser is reduced from 50 MB to 8 MB, providing JSON overhead around the explicit image ceiling. Invalid input receives a 400 with field-level validation issues. Chat errors return a generic message. The active chat/translation/retrieval/history log statements no longer print prompt text, answer excerpts, session IDs, images, or raw provider error messages/bodies. Provider-specific operational logs still need a proper structured telemetry and redaction policy before production.
- `GET /api/session/history/:sessionId` now rejects malformed/non-RFC4122-style UUIDs before Mongo lookup. This is input hygiene only; the UUID remains an opaque bearer identifier and history is not user-authenticated or private across users who obtain the ID.
- Limitations: allowed language values mirror current UI values even though translation quality and TTS locale support are not verified. Image dimension/pixel limits and actual decoded byte/MIME validation are not implemented. Empty image-only questions still depend on model behavior. Session ownership/authentication is unresolved.

### Frontend API origin configuration

- Replaced the chat component's fixed `http://localhost:5000` origin with `NEXT_PUBLIC_API_BASE_URL`, retaining localhost as the development fallback and stripping trailing slashes before paths are appended. Added `astrolynx-chatbot Frontend/.env.example` and documented local/deployment configuration in README.
- This is a build-time public setting; it must contain an API origin only, never a secret. Other UI paths outside `chat-interface.tsx` still need review for hard-coded endpoints before frontend migration is complete.

### Optional BM25 + dense RAG path

- Added `Backend/src/ingestion/buildLexicalIndex.ts` and `ingest:build-lexical` workspace scripts. The builder accepts only `chunk-plan-dry-run` reports marked `embedded:false` and `indexWritten:false`, validates unique SHA-256 chunk/source IDs and page metadata, caps at 50,000 chunks/128 MiB/20 million tokens/5 million postings, computes a corpus version from sorted chunk IDs, and creates a new output file with exclusive `wx`. It writes a local lexical sidecar only; it does not call embeddings or write to Pinecone.
- Added `Backend/src/ingestion/lexicalIndex.ts`, a dependency-light BM25 ranker with normalized Unicode tokenization, term-frequency/document-frequency statistics, BM25 `k1=1.2`, `b=0.75`, stable tie-breaking, provenance/page metadata, and a single-process lazy cache. Runtime loader validates the schema and enforces sidecar/chunk/token/posting caps. Query search scores only the compact typed-array postings for query terms rather than scanning every chunk; this is a design-level bound, not a measured latency result. The lexical query result is scored, not LLM-generated.
- Added optional validated `MOSDAC_LEXICAL_INDEX_PATH`. With no path, retrieval remains dense-only and performs no lexical file access. With a configured sidecar, `retrieveFromLexicalIndex` runs concurrently with Pinecone retrieval for each bounded query variant; both ranked lists enter the existing RRF and source-quality/provenance checks remain in place. LangGraph state carries the lexical ranked lists separately. BM25 errors fall back to dense-only and log only the error class.
- Built `/tmp/astrolynx-bm25-index-check.json` from the one-document, two-page chunk-plan artifact: one chunk, no embedding/vector write. Loaded it and queried “Waves Satellite Observations”; BM25 returned the source chunk with stable chunk/document IDs, `page: 2`, source path, corpus version, and BM25 score. This validates serialization/loading/ranking wiring only; a one-chunk fixture says nothing about real Recall@k, answer quality, production latency, or whether BM25 improves MOSDAC retrieval.
- README documents the command, opt-in env setting, memory behavior, limits, and the need to use only reviewed/quality-calibrated plans. Do not enable the temporary sample index for real users.

## Validation record (latest)

- `CI=true pnpm typecheck:api && git diff --check` — passed after rejecting duplicate IDs in feed snapshots and making atomic temp names collision-resistant. Host Node 26.5 emitted the known Node 24 engine warning. No tests were run.
- `CI=true pnpm ingest:plan-pdf-chunks -- --max-documents 1 --max-pages-per-pdf 2 --max-total-pages 2 --max-total-bytes 10485760 --max-total-tokens 100 --output /tmp/astrolynx-pdf-chunk-token-budget-check.json && CI=true pnpm typecheck:api && git diff --check` — passed. It processed 6,541,473 bytes and exactly two pages; one page was usable, one skipped, one chunk was planned, 68 estimated tokens, no failures or index writes.
- Repeated the same sample with `--max-total-tokens 50` — passed budget behavior check: zero chunks, one usable page excluded by token budget, zero estimated tokens. Both reports remain under `/tmp`.
- `CI=true pnpm typecheck:api && git diff --check` — passed after removing duplicate history serialization from the LLM input. No tests or live provider calls were run.
- Re-ran the 50-token sample after aligning per-document counters: aggregate and document counts both show zero accepted pages, two skipped pages, one token-budget exclusion, and zero chunks. API typecheck and `git diff --check` passed.
- Re-ran the 100-token sample after reserving byte budget before parsing. It reports `bytesCountedAgainstBudget: 6541473`, with two pages, one accepted page, one skipped page, one 68-token chunk; API typecheck and diff check passed.
- `CI=true pnpm typecheck:web && CI=true pnpm lint:web` — passed with no ESLint warnings or errors after typing the browser speech APIs and chat history. `CI=true pnpm build:web` passed; Next reported successful compile, lint/type validation, static generation, and build trace collection.
- Default MOSDAC crawl dry-run — passed with eight official/catalog/feed seeds and `networkRequestsMade:false`. The bounded live RSS-listing crawl failed at fetch before any page request, both sandboxed and elevated; no feed content was retrieved.
- `CI=true pnpm typecheck:api && git diff --check` — passed after adding bounded signal-driven server/service shutdown.
- `CI=true pnpm typecheck:api && git diff --check` — passed after preferring shared chunk/source-page identity when fusing dense and lexical passages.
- `CI=true pnpm ingest:inspect-corpus -- --max-documents 1 --max-pages-per-pdf 2 --include-page-text-samples --output /tmp/astrolynx-pdf-review-sample.json && CI=true pnpm typecheck:api && git diff --check` — passed. The report inspected two pages and included capped text excerpts; manual read confirmed a short review page with extraction spacing defects and a second usable page. No source files or indexes were written.
- Full 56-document chunk-plan dry-run and lexical sidecar build — passed: 7 duplicate copies skipped before page parsing, 368 unique pages parsed, 346 unique chunks / 157,575 estimated tokens; sidecar builder accepted all IDs and wrote only under `/tmp`.
- Full current chunk-plan → BM25 builder check after source/page validation — passed at 346 chunks; typecheck and diff check passed. Output under `/tmp` only.
- `CI=true pnpm typecheck:api` and `CI=true pnpm build:api && git diff --check` — passed after adding configurable per-IP chat/session rate limits and explicit proxy-hop trust configuration.
- Final workspace gate `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && CI=true pnpm lint:web && CI=true pnpm build && git diff --check` — passed. Next production build ran lint and TypeScript checks and generated all 6 static pages. Host Node 26.5 emitted the known Node 24 engine warning. No automated tests were run.

- Latest `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check && CI=true pnpm build` — passed after Chromium response-byte cancellation/in-flight limits. Next.js build still skips lint; Node 26.5 emits the Node 24 engine warning.
- Authorized live normal-budget render — successful with 505,721 encoded bytes. Authorized 250,000-byte cancellation render — saved static fallback, recorded the expected over-budget error and 325,059 encoded bytes; browser renderer failures are reported separately from crawler fetch failures.
- `CI=true pnpm typecheck:api` and `git diff --check` — passed after optional lexical retrieval, LangGraph state wiring, lexical sidecar builder, and live crawler failure cleanup.
- Latest `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check && CI=true pnpm build` — passed after compact BM25 postings and aligned sidecar limits. Production build still skips lint per Next.js config.
- Latest `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check && CI=true pnpm build` — passed with optional BM25 + dense RRF wiring. Next.js still reports lint skipped by the existing configuration; Node 26.5 emits the Node 24 engine warning.
- Lexical sidecar builder/load/rank smoke — built one chunk from the bounded chunk plan into `/tmp/astrolynx-bm25-index-check.json`; BM25 loaded it and returned one ranked passage with page/source metadata. No vector embeddings or external index were written.
- Compact BM25 follow-up — recreated `/tmp/astrolynx-bm25-index-check-2.json`; same “Waves Satellite Observations” query returns the same page 2/chunk ID and BM25 score. Compact posting layout keeps term postings in typed arrays; runtime caps are 128 MiB / 50k chunks / 20M tokens / 5M postings.
- `CI=true pnpm typecheck:api && git diff --check` — passed after catalog alias and PDF chunk planner changes. The first typecheck caught use of `Array.prototype.at`, unsupported by the API TypeScript target; replaced with indexed access and reran successfully.
- `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check && CI=true pnpm build` — passed after feed entry identity/preview separation and chat/history validation plus log redaction. Next build still skips linting per existing config; Node 26.5 emits the Node 24 engine warning.
- `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check && CI=true pnpm build` — passed with feed entry persistence integration. Next build still skips linting per existing config; host Node 26.5 emits the Node 24 engine warning.
- Latest `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check && CI=true pnpm build` — passed after stale-failure clearing and live feed persistence; Next.js continues to skip linting per config.
- Authorized fresh one-request feed crawl — 25 created entries; second one-request refresh — 25 unchanged entries, zero failures after the stale-failure fix. Persisted JSON/manifest/state inspected from `/tmp`.
- Feed persistence replay from saved ISROCast XML — passed create/unchanged/inactive/update state transitions; store output was limited to `/tmp/astrolynx-feed-entry-store-smoke`.
- Revised stable identity replay — changing the first product's title/description updated that same entry ID (1 updated, 24 unchanged), then reducing snapshot to 24 entries marked one inactive; output under `/tmp/astrolynx-feed-entry-store-smoke-v2`.
- `CI=true pnpm typecheck:web && CI=true pnpm build:web && git diff --check` — passed after making the chat API origin configurable at build time. The remaining localhost reference is only the fallback; no other API endpoint is hard-coded in the frontend source scan.
- Offline replay of saved ISROCast XML — extracted 25 entries with stable entry IDs; first record has product filename/acquisition/publication metadata, preview URL, and no invented product URL; preview JPGs generated zero crawl links.
- `CI=true pnpm typecheck:api && CI=true pnpm ingest:plan-pdf-chunks -- --max-documents 1 --max-pages-per-pdf 2 --output /tmp/astrolynx-pdf-chunk-plan-check-3.json && git diff --check` — passed after reusing the extractor's content hash. Counts remain one accepted page, one skipped page, one chunk, and 68 estimated tokens.
- Bounded PDF planner sample — passed as detailed above; output was exclusively created under `/tmp`; no data/index side effects.
- `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check && CI=true pnpm build` — passed after the PDF planner and satellite schema fix. API TypeScript build and Next.js production build completed. Next.js output says “Skipping linting”; lint is not validated and the configured bypass remains in place. Node 26.5 still emits the expected Node 24 engine warning.
- Offline replay of saved rendered satellite HTML — `catalog_empty`, seven headers, zero rows after adding the observed composite header alias.
- Authorized satellite render crawl — 1 top-level page, 12 browser requests, 1 rendered page, zero crawler failures; MOSDAC page explicitly says no products are available. Raw and rendered HTML are under `/tmp/astrolynx-mosdac-satellite-rendered-check`.
- `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check` — passed after citation UI/data contracts and single-query retrieval changes. Node 26.5 emits the expected Node 24 engine warning.
- `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check && CI=true pnpm build` — passed after strict source filtering, citation metadata edge-case handling, and partial Mongo connection cleanup.
- `CI=true pnpm build` — passed after the bounded browser renderer and catalog/feed adapter implementation; API and frontend production build completed.
- `CI=true pnpm typecheck:api` — passed for the typed catalog row and feed entry adapters.
- Authorized one-request ISROCast feed crawl — saved one XML feed (29,365 bytes), 25 structured entries, 0 crawl failures.
- Offline catalog extraction from static and rendered radar samples — both correctly yielded 0 rows; static response flagged unresolved template bindings; rendered response recognized headers and ignored the empty-state row.
- Authorized one-page browser rendering crawl — rendered radar page with one top-level page request and 37 same-host browser subrequests; 0 crawl failures. It found “No data available in table.”
- Failed dependency-free normal pnpm relink attempt produced registry DNS `ENOTFOUND`; interrupted it and explicitly installed using the existing pnpm store path. No source files were affected by the interrupted install.
- `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web` — passed after crawler/extraction changes (Node 26.5 emits the expected Node 24 engine warning).
- `CI=true pnpm install --frozen-lockfile --store-dir /Users/raven/Library/pnpm/store/v11` — passed, reusing 922 packages and running reviewed lifecycle scripts.
- `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web && git diff --check` — passed after adding Playwright and the bounded renderer.
- `CI=true pnpm build:api` — passed after renderer readiness and HTML wrapper extraction fixes.
- Authorized live one-page radar renderer crawl — 1 top-level page, 37 browser requests, 1 page rendered, 0 crawler failures; raw and rendered HTML saved under `/tmp`.
- Offline extraction of saved rendered HTML — preserves the table header and explicit empty state (180 characters; quality `review`).
- `CI=true pnpm build` — passed API compilation and Next production build after the latest crawler changes.
- `CI=true pnpm typecheck:api && CI=true pnpm typecheck:web` — passed again after the startup/liveness change.
- `CI=true pnpm build:api` — passed after text-quality policy v2.
- `CI=true pnpm typecheck:api` and `CI=true pnpm build:api` — passed for the new corpus inspector.
- Built CLI smoke run (`--max-documents 2 --max-pages-per-pdf 2`) — found 56 PDFs, inspected 2 files/4 pages, reported 2 usable, 1 review, 1 reject/no-text, with 0 file errors; no report file or index was written.
- Full bounded CLI reproduction (`--max-documents 100 --max-pages-per-pdf 8`, report in `/tmp`) — processed all 56 files / 423 pages with 0 file errors. Its usable/review/reject/no-text and signal totals exactly matched committed `docs/pdf_sample_quality.json`.
- `CI=true pnpm typecheck:api` — passed after adding quality metadata to crawler HTML/feed records.
- Final `CI=true pnpm build:api` — passed after crawler quality metadata change; `git diff --check` passed with README update.
- `CI=true pnpm typecheck:api` — passed after single-flight service initialization and partial-client cleanup.
- `CI=true pnpm typecheck:api && git diff --check` — passed after per-hop robots redirect enforcement.
- `CI=true pnpm typecheck:api && git diff --check` — passed after marking deterministic fetch policy errors as non-retryable.
- `CI=true pnpm build:api && git diff --check` — passed after the redirect-policy and single-flight initialization changes.
- Read-only corpus sample via `extractPdfPages` — processed first 8 pages of every manifest PDF (56/56 files, 423 parsed pages, 0 file errors); JSON report written to `docs/pdf_sample_quality.json`.
- Offline built-output extraction of saved `catalog/radar.php` — confirmed Angular/template detection and signals.
- `git diff --check` — passed after crawler changes.
- No tests were added or run. Build/type checks and one bounded, authorized network smoke crawl were used as implementation checks.

## Decisions still unresolved

These should be settled before dependent implementation. Continue work on independent inventory/scaffolding while waiting; do not silently commit to a provider or erase data.

1. Which model provider/model is available and affordable for answer generation, and is Gemini still desired?
2. Which embedding provider/model should be used? The previous local Ollama model (`nomic-embed-text`) and Pinecone index dimensions must be verified before reuse.
3. Is the Neo4j graph a real first-release requirement, or should it be retired after preserving any useful data?
4. Workspace decision is made for now: keep both existing app directories (including the frontend path with a space) and manage them through root pnpm workspace scripts. Revisit only if tooling proves the layout untenable.
5. Are there production MongoDB/Pinecone/Neo4j environments or user conversations that must be migrated? No external data services have been queried.
6. Is authentication/session privacy required for first release, beyond an opaque UUID session key?
7. Confirm image input, audio mode/TTS, and translation as first-release features; current UI exposes some of these but the desired plan focuses on grounded chat and English/Hindi.
8. Which of the downloaded PDFs are known-good or known-bad examples from the earlier 7k-page crawl? The corpus needs provenance mapping and a labeled regression subset.

## User direction update — pause crawler and do not create embeddings (2026-10-11)

- The user asked to pause crawler work and prioritize fixing RAG, modernizing the backend, and improving the frontend UI. Crawler work is paused at its current bounded discovery/inspection capability; its unresolved limitations remain recorded in earlier sections and `REWRITE_PLAN.md`.
- The user does not want new embeddings at this stage. Do not run embedding/index-write jobs or rebuild Pinecone. RAG fixes should use source-level review, the optional local BM25 sidecar, the existing index in read-only mode if configured, and offline evaluations. Any later index migration or embedding run requires an explicit user decision.
- No secrets are needed for source-level work. For real retrieval/chat validation without index writes, configure the legacy service locally in `Backend/.env`: `PINECONE_API_KEY` + `PINECONE_INDEX_NAME` for vector queries; `OLLAMA_BASE_URL` and the already-installed `nomic-embed-text` model because Pinecone vector queries need query embeddings; `GEMINI_API_KEY` + `GEMINI_MODEL` for generation; and `MONGO_URI`, `MONGO_DB_NAME`, `MONGO_COLLECTION_NAME`, and `MONGODB_CHECKPOINTS_COLLECTION_NAME` only for session history/checkpoint integration. Never paste credentials into chat or commit `.env` files. Prefer disposable/local MongoDB for multi-turn verification; do not point validation at production conversations without explicit approval.
- Trustworthy retrieval evaluation also needs real MOSDAC questions with the exact expected source PDF/page, plus any known-bad historical PDFs/pages. These labels are not required for source-level fixes but are required before claiming answer accuracy. No credentials, user queries, or source labels have been provided yet.

## Next work queue

### Active priority — RAG and app modernization; crawler paused

1. Continue auditing/fixing the existing RAG request path using the legacy index read-only; do not create embeddings or write to indexes. The checkpoint reducer fix removes stale history/retrieval from future turns but still needs a disposable multi-turn runtime check.
2. Inspect legacy vector metadata/config only when the user configures service access; verify provenance, namespaces, embedding compatibility, and query-vector dimensions before retrieval. No service credentials or index contents are currently available.
3. Build answer-level evaluation from user-provided MOSDAC question/source/page labels; compare dense and optional BM25/RRF, citation support, abstention, latency, and cost. The ten-query BM25 seed set is self-authored and provisional.
4. Modernize backend contracts and lifecycle independent of provider choices: explicit request/response/history schemas, one authoritative conversation-history path, bounded context, timeouts/cancellation, consistent errors, and remove dead orchestration only after the migration mapping is clear.
5. Audit and improve the frontend chat flow and visual hierarchy after the API contract is clear; keep advertised features truthful and preserve useful visual behavior.
6. Validate API/frontend under pinned Node 24 when available. Current host Node 26.5 reports an engine mismatch.

### Deferred — crawler and ingestion follow-up

Resume crawler work when needed for RAG evaluation/data sources: validate the remaining four feeds live, improve strict browser byte enforcement, add parser/OCR fallback, and calibrate quality rules against visually inspected known-good/known-bad pages. The bounded crawler is a usable discovery prototype, not production ingestion approval. No bulk embedding is authorized by the current direction.

## Latest completed work — PDF title provenance in citations (2026-10-10)

- `Backend/src/ingestion/pdfPages.ts` now reads the PDF Info `Title` field and sanitizes it by replacing control characters, collapsing whitespace, trimming, and truncating to 300 characters. Empty or non-string metadata is ignored. The original file remains untouched.
- `Backend/src/ingestion/planPdfChunks.ts` carries the sanitized title on every planned chunk. If metadata has no usable title, the filename stem is used, so a citation has a meaningful document label without relying on an unsafe arbitrary metadata value. Chunk identity remains based on source SHA-256, page number, chunk number, and text; adding a display title does not change IDs.
- `Backend/src/ingestion/buildLexicalIndex.ts` requires a nonempty title of at most 300 characters in newly generated plans. `Backend/src/ingestion/lexicalIndex.ts` accepts old v1 sidecars where title is absent (backward-compatible fallback to source filename) and places title in each BM25 result's LangChain metadata for citation display.
- `README.md` documents title fallback and citation provenance. A fresh bounded full-corpus dry run created `/tmp/astrolynx-pdf-titles-plan.json`: 56 documents processed, 7 exact duplicates skipped, 368 pages parsed, 293 pages provisionally accepted, 75 skipped, 346 chunks, 157,575 estimated tokens, 0 document failures. The lexical builder created `/tmp/astrolynx-pdf-titles-index.json` with 346 chunks (776,507 bytes), no embeddings, and no vector-index writes. Inspection confirmed the sample title `PowerPoint Presentation` appeared in both plan and sidecar.
- `CI=true pnpm typecheck:api` passed. The dry-run commands were `CI=true pnpm ingest:plan-pdf-chunks -- --max-documents 100 --max-pages-per-pdf 8 --max-total-pages 500 --max-total-bytes 1073741824 --max-total-tokens 200000 --output /tmp/astrolynx-pdf-titles-plan.json` and `CI=true pnpm ingest:build-lexical -- --plan /tmp/astrolynx-pdf-titles-plan.json --output /tmp/astrolynx-pdf-titles-index.json`; both succeeded. pdf.js emitted its existing `TT: undefined function` warnings during extraction. pnpm also warns the environment uses Node 26.5.0 while the repo specifies Node 24; clean pinned-runtime validation remains outstanding.
- Limits: titles are display metadata only; they are not included in chunk text/embeddings or chunk ID derivation. BM25 sidecar generation was verified, but runtime citation rendering with a live chat/index and title accuracy against human labels have not been evaluated. The PDF quality heuristic remains uncalibrated, so this run is planning evidence, not production ingestion approval.

## Latest completed work — offline lexical retrieval evaluator (2026-10-11)

- Added `Backend/src/ingestion/evaluateLexical.ts` and root/API `rag:evaluate-lexical` scripts. The CLI loads a specified BM25 JSON sidecar and a bounded human-labeled JSON dataset; it does not use network services, call models, embed content, or write indexes.
- Dataset validation requires 1–1,000 unique questions, query length <=2,000 chars, and 1–100 expected relevance labels per question. Labels use exact PDF `sourceId` SHA-256 and optional one-based `pageNumber`, allowing either page-level or document-level relevance. Output includes per-question top passage provenance and aggregate hit rate, Recall@k, MRR, nDCG@k, and local sidecar-search p50/p95 latency.
- Added `docs/evaluation/README.md` with labeling instructions, format, metrics, limitations, and command usage; linked it from `README.md`. Updated the product README and next-work queue to distinguish the now-present evaluator from the still-missing human-labeled MOSDAC set and measured retrieval results.
- `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. The host reports Node 26.5.0 despite the repository's Node 24 engine requirement; pinned Node 24 verification remains pending. Evaluation was not run against fabricated labels; no MOSDAC accuracy result is claimed.
- Scope boundary: this measures BM25 retrieval only. It does not score answer correctness, citations/entailment, abstention, hybrid/dense comparison, embedding/API cost, or end-to-end latency. The next meaningful evaluation step needs reviewed labels from the actual MOSDAC corpus; the evaluator cannot create those labels automatically.

## Latest completed work — citation integrity through output translation (2026-10-11)

- `Backend/src/Services/translateText.ts` now replaces answer citation references such as `[S1]` with unique opaque placeholders before translation and instructs the translator to preserve them exactly once. It restores the original references only if every expected placeholder appears exactly once and no unprotected `[S#]` citation was introduced.
- If the translation changes, omits, duplicates, or invents citation markers, the function returns the original English answer, preserving the correspondence between answer references and the evidence footer created later in `main.ts`. This avoids sending a translated answer with missing or fabricated source references.
- `README.md` documents the citation-preservation behavior. `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. No live translation call was made; semantic translation quality and the fallback path still need provider-backed evaluation.
- This protects citation syntax and linkage only; it does not independently prove each translated factual claim remains semantically faithful. Translation behavior remains part of the future multilingual answer evaluation.

## Latest completed work — provisional BM25 seed evaluation and title safety correction (2026-10-11)

- Read-only inspected 48 pages from 8 PDFs with text excerpts (`/tmp/astrolynx-eval-review-2026-10-11.json`): 35 pages heuristically usable, 10 review, 3 reject/no-text, 0 parser failures. Direct inspection of candidate source pages confirmed the question facts and exact one-based page labels for the provisional evaluation set.
- Added `docs/evaluation/mosdac-seed-queries.provisional.json` and its companion note. The 10 questions cover four local reports and use exact PDF content hashes with page labels. Because the author created queries/labels during source review and the set is small/selective, it is a smoke/diagnostic seed set, not an independent gold set or broad accuracy evidence.
- A full bounded plan (56 PDFs, 7 duplicate copies skipped, 368 pages parsed, 293 provisionally accepted, 75 skipped, 346 chunks, 157,575 estimated tokens, no failures) was built into `/tmp/astrolynx-eval-plan-final.json` and `/tmp/astrolynx-eval-index-final.json` (346 chunks, 778,383 bytes; no embeddings/vector writes). This fresh plan was generated after the citation title change below.
- Repeated the evaluator at `k=5` with one warmup and 25 measured searches per question. Provisional metrics: hit rate@5 1.0, recall@5 1.0, MRR 0.7783, nDCG@5 0.8237; local sidecar-search p50 0.064 ms, p95 0.103 ms. The perfect hit/recall result is expected to be optimistic on a hand-selected ten-question set; low MRR shows relevant pages often are not top-ranked. These numbers exclude load/startup, embedding, network, RRF, and generation and do not show end-to-end speed or answer correctness.
- The retrieval output surfaced generic PDF titles (`PowerPoint Presentation`, `xxx`, encoded control strings), and experiments with first-pages text inference selected abstracts/affiliations on other PDFs. Removed that heuristic rather than assigning a plausible but unsupported title. `pdfPages.ts` now accepts only sanitized non-generic PDF Info titles; if missing/junk, the planner's existing filename-stem fallback is used. This keeps title provenance truthful; good embedded document titles still pass through.
- The evaluator now warms each query and repeats search (`--repeats`, default 10) before reporting local search percentiles, avoiding a first-query JIT outlier. `docs/evaluation/README.md` explains the method and links the provisional set. No query or chunk IDs changed; corpus version stayed `23f71848a24eac952460bc53b1b96f1da790d50de7fad1ef2ed7d72e570bae68`.
- Remaining evidence gap: no independent labels, dense-vs-BM25-vs-RRF comparison, multilingual/table/unanswerable coverage, or answer citation-support judging. Quality heuristics remain provisional and no production ingestion/index write was made.

## Retrieval experiment — English stopword weighting rejected (2026-10-11)

- Compared the unchanged BM25 baseline to two temporary analyzers on the same 346-chunk sidecar and ten-query provisional set (`k=5`, one warmup and 25 measured runs/query). Baseline: hit rate@5 1.0, recall@5 1.0, MRR 0.7783, nDCG@5 0.8237, local search p50/p95 0.064/0.103 ms. Removing common English stopwords from documents and queries: hit/recall@5 0.9, MRR 0.82, nDCG@5 0.8307, p50/p95 0.026/0.064 ms. Downweighting stopwords to 0.2 in query scoring while retaining postings: same 0.9 hit/recall, 0.82 MRR, 0.8307 nDCG, and 0.063/0.103 ms p50/p95.
- Rejected both variants because they lose a relevant page in top five on this set and the weighted variant showed no latency improvement. Reverted all analyzer changes; `lexicalIndex.ts` retains baseline BM25 tokenization/scoring. Temporary comparison sidecars remain in `/tmp` only; the committed corpus, chunk IDs, PDF data, and vector store are unchanged.
- These numbers are diagnostic only, heavily limited by the author-created ten-query set, 346 chunks, warm local runtime, and absence of an independent judge. No BM25 configuration change is justified until broad, independent relevance labels and dense/RRF comparison exist.

## Latest completed work — serialize concurrent MOSDAC feed reconciliation (2026-10-11)

- `Backend/src/ingestion/feedEntryStore.ts` now acquires an exclusive per-feed `.writer.lock` before reading the prior manifest or changing entry/manifest records. This serializes same-feed writers across processes sharing the local filesystem; separate feed IDs can still persist concurrently.
- The lock record includes PID, hostname, acquisition time, and an ownership UUID. Acquisition waits with jitter for up to 30 seconds, then fails with owner details rather than overwriting an active writer. Release checks the UUID before unlinking so a process cannot remove a lock it no longer owns.
- Locks are intentionally not reclaimed automatically: after a crash the operator must verify the recorded process is stopped before removing the lock. This fail-closed choice avoids a stale-lock timeout deleting or bypassing another writer. README explains this recovery procedure.
- Existing entry JSON and manifests are preserved; no stored feed corpus was touched by this code change. `CI=true pnpm typecheck:api` and `git diff --check` passed. No concurrency or crash simulation test was run, so filesystem behavior still needs runtime verification before multi-process deployment.

## Latest completed work — serialize resumable MOSDAC crawl state (2026-10-11)

- Added `Backend/src/ingestion/fileLock.ts` as the shared exclusive local-filesystem lock implementation, retaining owner PID, hostname, acquisition time, and random ownership token. Existing per-feed snapshot locking now uses this shared helper.
- `Backend/src/ingestion/mosdacCrawler.ts` now holds `<outputDirectory>/.crawl.lock` from before loading `state.json` through the final state save. This prevents two crawler processes using the same output directory from independently consuming the same queue and replacing one another's `seen`, `completed`, validator, failure, and byte-count state.
- Locks wait up to 30 seconds with jitter and fail closed with owner details. They are not auto-reclaimed after crashes; operators must verify process ownership before deleting a stale lock. Different output directories remain independent. Feed snapshot locks remain necessary because feed records are written in per-feed directories and can be reconciled separately.
- `README.md` now documents both lock files and recovery. No crawl state, feed entries, PDFs, or indexes were modified.
- Verification: `CI=true pnpm typecheck:api && CI=true pnpm build:api && git diff --check` passed. pnpm warned that the available Node 26.5.0 does not satisfy the Node 24 project engine. No concurrency/crash simulation was run, and clean Node 24 verification remains outstanding.

## Latest completed work — positional PDF quality sampling (2026-10-11)

- `Backend/src/ingestion/pdfPages.ts` and `inspectCorpus.ts` now support `--sample-page-positions`: first, middle, and last pages are extracted and quality-scored for each selected PDF, while nonselected pages are marked `not_processed`. Duplicate positions collapse for one- or two-page files. Corpus aggregates count only the sampled/extracted pages, and reports identify the sampling method and selected one-based page numbers.
- The sampling path first reads PDF page-count metadata with a one-page no-text pass, then traverses at most 500 pages per file and calls `getTextContent` only for the three selected pages. A larger PDF is reported as a per-document inspection failure with an explicit traversal-cap reason instead of silently claiming a full positional sample. This is an inspect-only path; it does not change PDFs, chunk plans, embeddings, or indexes.
- Added the invocation to `README.md`; `--include-page-text-samples` can be combined with positional sampling to create a human-review bundle, which contains excerpts from the selected source pages.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm ingest:inspect-corpus -- --max-documents 100 --sample-page-positions --include-page-text-samples --output /tmp/astrolynx-pdf-position-sample-2026-10-11.json`, and `git diff --check` passed. The read-only run processed all 56 PDFs with no document failures and extracted 167 distinct pages (122 usable, 29 review, 16 reject; 14 had no text layer). Spot-checking report metadata confirmed page numbers 1/19/38 for a 38-page PDF and 1/46/92 for a 92-page PDF. Existing pdf.js font warnings (`TT: undefined function: 22/32`) appeared on some documents. The detailed excerpt report stays in `/tmp`, not the repository; source PDFs were not modified. Node 26.5 still warns against the Node 24 project engine.
- Reviewed flagged excerpts across covers, captions, sparse lists, private-use glyph pages, empty text-layer pages, and damaged equation pages. The judgment and remediation distinctions are documented in [`docs/pdf_position_sample_review.md`](./docs/pdf_position_sample_review.md); it is explicitly an exploratory excerpt review, not a gold set or visually inspected PDF annotation. It shows why “reject” must distinguish image-only OCR candidates from text-layer corruption, and why short/repeated-line warnings must not be mistaken for gibberish.
- `CI=true pnpm typecheck:api && git diff --check` passed after the review documentation change. No thresholds were tuned from this small selected sample, and historical good/bad crawl examples still need to be identified.

## Latest completed work — reset checkpointed RAG evidence per turn (2026-10-11)

- `Backend/src/Services/LangGraphChain.ts` previously used append reducers for `chat_history`, `raw_pinecone_results`, and `raw_lexical_results`. The chat entrypoint passes freshly loaded bounded MongoDB history on every request, and the retrieval node searches the current query again. With session checkpointing enabled, append semantics can retain old turns and old evidence across graph invocations, causing duplicate history, stale passages to influence RRF, and unbounded checkpoint-state growth.
- Changed those three reducers to replace the prior value with the current invocation's value. This matches the actual lifecycle: MongoDB owns persisted history; each invocation does a fresh retrieval. Other reducers/state fields were not changed.
- No model, embedding, Pinecone write, MongoDB migration, or data deletion was performed. Existing checkpoint documents remain intact; this change only affects future graph state updates.
- Verification: `CI=true pnpm typecheck:api && CI=true pnpm build:api && git diff --check` passed. pnpm warns the environment is Node 26.5.0 while the workspace requires Node 24. No live MongoDB/checkpointer request or multi-turn reproduction was run; validate against a disposable session before production rollout. Crawler enhancements are paused per the user's direction; its documented gaps remain.

## Latest completed work — type LangGraph retrieval state (2026-10-11)

- Replaced `any[]` state annotations for chat history and retrieved documents in `Backend/src/Services/LangGraphChain.ts` with `BaseMessage[]`, `Document[]`, and `Document[][]`. This matches `AgentState` and retrieval return types, so future graph changes receive TypeScript checks at the history, dense/lexical result, and fused-document boundaries.
- Runtime behavior and serialized state shapes are unchanged. No checkpoint migration or database/index write was performed.
- Verification: `CI=true pnpm typecheck:api && git diff --check` passed. pnpm warns that the host is Node 26.5.0 while the project requires Node 24. No tests were added or run.

## Latest completed work — fail closed on invented RAG source IDs (2026-10-11)

- `Backend/src/Services/ChatWithLLM.ts` previously removed unknown citation markers from an answer but kept the surrounding factual text. For example, a generated statement citing `[S99]` could be shown uncited after `[S99]` was stripped.
- The answer path now returns a groundedness fallback if any `[S<number>]` citation is not present in the supplied evidence set. It no longer edits only the marker out of a response. If evidence was supplied but the answer contains no supported citation and is not an explicit abstention, the existing fallback remains. Valid responses pass through with their known citation markers.
- The prompt now explicitly says chat history can clarify conversational references but is not current evidence, and prohibits reusing prior source IDs/facts. Only the current-turn evidence blocks may support MOSDAC factual claims and citations.
- Removed an unused `AIMessage` import. No provider call, embedding, index write, or persisted data change occurred.
- The first API typecheck exposed a pre-existing project/compiler mismatch: `Backend/tsconfig.json` specified `ignoreDeprecations: "6.0"` while the installed compiler is TypeScript 5.9.3. Changed it to the supported `"5.0"` value for the current TypeScript 5.x dependency range.
- Verification: after that config fix, `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. pnpm still warns that host Node 26.5.0 does not satisfy the project Node 24 range. No answer-generation/evaluation tests were added or run; validate fallback behavior against a disposable model session and judged questions when credentials/data are available.

## Latest completed work — anchor explicit same-script RAG follow-ups (2026-10-11)

- `Backend/src/Services/Retrival.ts` now detects a narrow set of explicit follow-up openings (for example, “what about…”, “what is its…”, “how does it…”, and “tell me more”) and prepends the prior user question as a retrieval-only anchor, capped at 400 characters. The user-facing `state.question` is unchanged; answer generation still receives the actual current question and chat history.
- The anchor is used only when both current and previous user text are at least 80% Latin-script letters. This avoids combining original Hindi/other-script chat history with the English query after input translation. First-turn queries and non-matching questions remain unchanged. No extra LLM call or query variant was added; the configured retrieval backends still receive one query.
- Previous assistant answers are deliberately not used as retrieval evidence/anchor, preventing unsupported generated claims from steering retrieval. This is a deterministic heuristic and needs follow-up relevance evaluation before broadening its trigger patterns.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. pnpm warns that the available Node 26.5.0 is outside the project Node 24 engine range. No tests or live retrieval calls were run; no embeddings or index writes occurred.

## Latest completed work — reduce context-budget tokenizer passes (2026-10-11)

- `Backend/src/Services/Memory.ts` previously retokenized the entire evidence context once per removed document until it fit the 4,000-token ceiling. Context is ranked and built as ordered prefixes, so the largest prefix that fits can be found with binary search.
- Context assembly now uses binary search over 0..N evidence blocks, then retains the largest prefix within the token ceiling. In the worst case with six source blocks this reduces token-count calls from up to six linear attempts to at most three; ranking and source order are unchanged. If even the first block exceeds the budget, no evidence block is included and citations are empty so answer generation follows its no-evidence/abstention policy.
- This is a bounded algorithmic reduction in tokenization work; no end-to-end speedup is claimed without measurement. No embeddings, index writes, or persisted data changes occurred.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed during the subsequent API validation. No tests or live provider calls were run; pnpm warns that host Node 26.5.0 is outside the declared Node 24 range.

## Latest completed work — bound and validate chat history responses (2026-10-11)

- `Backend/src/Controllers/sessionController.ts` now asks MongoDB for only the latest 100 stored chat messages using `$slice`, so history retrieval does not transfer an entire long-lived conversation document to the API process.
- History serialization now accepts only LangChain `human` and `ai` records with nonempty string or text-block content. Malformed records and unsupported message roles are skipped instead of being returned with a guessed assistant role. Individual message content is capped at 16,000 characters, bounding the response payload to at most 100 such message bodies plus JSON overhead.
- Removed an unused memory import and replaced `any[]`/`any` message handling with explicit runtime narrowing. The frontend response shape remains unchanged. Existing MongoDB documents are read only and were not modified.
- The stored LangChain history format has no per-message timestamp. The API continues returning the parent document ObjectId timestamp for every message; this is a session-document creation timestamp, not a precise message timestamp. A schema migration would be needed to provide true per-message times.
- Verification: `CI=true pnpm typecheck:api && git diff --check` passed. The host Node 26.5.0 still warns against the declared Node 24 engine. No tests, MongoDB calls, provider calls, index reads, or writes were performed.
- Remaining storage limitation: history is still stored as one growing MongoDB `messages` array, so this response bound does not prevent that document from eventually approaching MongoDB's document-size limit. Changing the persisted history schema requires a separate migration plan that preserves existing conversation data.

## Latest completed work — cap conversation history sent to the answer model (2026-10-11)

- `Backend/src/Services/Memory.ts` now exposes `boundChatHistory`, which retains a contiguous suffix of the newest history within a 12,000-character serialized-content budget. If the budget boundary would leave an assistant response without its preceding user message, that orphaned response is dropped. An over-budget newest message yields no history rather than exceeding the prompt budget.
- `Backend/src/Services/main.ts` applies this bound after loading the existing `BufferWindowMemory` window and before invoking LangGraph. The LLM can still use recent history to resolve follow-ups, while historical messages cannot grow the prompt without limit. Current user input and retrieved evidence are governed separately.
- This bound is a character/serialized-size ceiling, not a model-token ceiling; it is predictable and avoids another tokenizer/network call. It also does not change the separately persisted MongoDB history or LangGraph checkpoint data.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. The host Node 26.5.0 warns because the project specifies Node 24. No provider/database calls, tests, embeddings, or index writes were performed.
- Runtime validation still needs follow-up cases in a disposable session (short exchanges, an over-budget message, and a follow-up that relies on the retained turn). The exact token and answer-quality effects have not been measured.

## Latest completed work — remove redundant post-save MongoDB lookup (2026-10-11)

- `Backend/src/Services/main.ts` previously saved the user/assistant messages through `MongoDBChatMessageHistory`, then issued another MongoDB `findOne` for `{ sessionId, "data.content": finalAiResponse }`. LangChain stores messages inside `messages[]`, so that predicate did not match its persisted document shape; the code normally fell back to a millisecond ID and a local timestamp after the extra database round trip.
- The chat path now returns the already available final answer directly after `memory.saveContext` completes, with a `randomUUID()` response ID and current ISO timestamp. The API response contract remains `{ id, content, role, timestamp, audioData?, citations }`; message persistence and retrieval history are unchanged.
- This removes one guaranteed failed lookup per turn and avoids potential collisions from millisecond response IDs. It does not claim a measured latency gain. The response ID remains a transport/UI identifier; history IDs are synthesized separately from the session document and message offset because the existing storage schema has no per-message IDs.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. The first whitespace check identified a trailing blank line in the already modified `Backend/.env.example`; it was normalized to one final newline and the check then passed. Node 26.5.0 continues to warn against the project Node 24 requirement. No database/provider calls, tests, embeddings, or index writes were performed.

## Latest completed work — type the compiled chat graph and error boundaries (2026-10-11)

- `Backend/src/Services/LangGraphChain.ts` now types its exported compiled graph from `ReturnType<typeof workflow.compile>` instead of `any`. `main.ts` verifies the graph exists after lazy initialization and captures the non-null graph before invoking it; an initialization path that returns without compiling now fails explicitly instead of risking a null dereference.
- Replaced explicit `any` catch variables with `unknown` in the active chat controller, answer generation, chat entrypoint, service initialization, graph audio node, and TTS provider/controller. TTS provider error diagnostics now inspect Axios request/response details only after `axios.isAxiosError` narrows the value. The HTTP controller returns a stable generic error rather than reading arbitrary `.message` from an unknown value.
- This is source-level type hardening; no runtime request/graph/provider was exercised. A repository search confirms no explicit `any` type remains in the listed active chat/service/controller paths; the only `any` text matches are natural-language prompt wording in `translateText.ts`.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Host Node 26.5.0 still warns against the Node 24 project engine. No tests, provider/database calls, embeddings, or index writes were performed.

## Latest completed work — prevent stale chat responses crossing sessions (2026-10-11)

- `astrolynx-chatbot Frontend/components/chat-interface.tsx` now attaches an `AbortController` to active text and audio chat requests. Starting a new chat aborts an earlier request before clearing the transcript; late aborted responses/errors are ignored, so a prior session's answer cannot be appended to the new transcript. Unmount aborts the active request.
- Closing audio mode now marks the audio session inactive before stopping speech recognition, aborts its request, pauses any playing audio, and restores the typing state. Transcript callbacks and audio playback completion check that the audio session is still active. During audio requests/while the audio modal is open, text and audio controls are disabled to prevent overlapping turns through the shared request slot.
- The UI retains optimistic user messages when a request is cancelled by starting a new chat, but that transcript is immediately cleared with the old session. Express/LangGraph cancellation propagation was added in a follow-up logged below. PineconeStore/Ollama query embeddings do not expose a per-call abort parameter in the installed interfaces, so an in-flight retrieval request may finish after the graph stops waiting.
- Verification: `CI=true pnpm typecheck:web`, `CI=true pnpm lint:web`, and `git diff --check` passed. Node 26.5.0 warns against the project Node 24 engine. No browser interaction, backend runtime, provider, or database was exercised.

## Latest completed work — align frontend image uploads with the API contract (2026-10-11)

- `astrolynx-chatbot Frontend/components/chat-interface.tsx` now offers only PNG, JPEG, and WebP in the file picker, matching the API's accepted data-URL MIME types. It rejects files above 5 MiB before reading/base64 encoding; this leaves the resulting data URL below the API's 7,000,000-character `imageData` ceiling.
- FileReader results are type-checked and read errors are shown inline with `role="alert"`. The file input resets after selection so the same file can be retried. A superseded read is aborted, stale reader callbacks are ignored, and selected preview object URLs are revoked when replaced or cleared.
- The draft image remains available if a later attempted selection is rejected, and the visible error explains why the new file was not accepted. No server/API limits were changed.
- Verification: `CI=true pnpm typecheck:web`, `CI=true pnpm lint:web`, and `git diff --check` passed. Node 26.5.0 warns against the project Node 24 engine. No browser upload, API, model, or database request was run.

## Latest completed work — recover visibly from session/history startup failures (2026-10-11)

- `astrolynx-chatbot Frontend/components/chat-interface.tsx` now validates locally stored and newly returned session IDs as UUIDs, checks the session-creation HTTP status, and verifies the response actually contains a valid ID before enabling chat. A malformed stored ID is removed and replaced with a newly created session.
- History loading now returns an explicit success/failure result and safely handles a non-array `history` payload. If a valid session's history request fails, the ID is retained and the chat draft is not silently reset; the UI presents a visible retry action and disables message sending until history is restored. Session creation/network failures also show a visible retryable message instead of only logging to the console.
- The behavior preserves local session history on transient fetch failures. It does not automatically abandon an existing session or create a replacement when its history API is unavailable. No backend endpoint or persisted record was changed.
- Verification: `CI=true pnpm typecheck:web`, `CI=true pnpm lint:web`, and `git diff --check` passed. Node 26.5.0 warns against the Node 24 project engine. No browser/session API/database runtime was exercised.

## Latest completed work — serialize lexical sidecar path switches (2026-10-11)

- Inspection confirmed `loadMosdacBm25Index` already caches the configured sidecar after the first query; it does not reread/rebuild the BM25 index on every search. The README accurately says it loads lazily and is held in process memory. The initial suspicion of per-query disk loading was incorrect.
- Fixed a separate concurrency race when callers request different sidecar paths in one process. Previously a single `loadedPath`/`loadPromise` pair could be overwritten by a second path while the first load was in flight; completion order could leave index A stored under path B and return the wrong corpus on a later call.
- The loader now coalesces same-path requests, makes different-path requests wait for the current bounded load, then loads the requested path. The process cache retains only the last requested corpus; changing the file at the same path still requires an API restart as documented. This preserves the single-sidecar retained-memory bound and avoids racing cache identity.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the project Node 24 engine. The path-switch race was reviewed statically but not exercised with a concurrent runtime reproduction; no tests, embeddings, database calls, or vector writes were performed.

## Latest completed work — propagate disconnected chat cancellation through supported model calls (2026-10-11)

- `Backend/src/Controllers/chatController.ts` now creates an `AbortController` per valid chat request and aborts it when the HTTP response closes before `writableEnded`. If the client is already gone or the request was aborted, the handler does not attempt to write a second error response.
- `Backend/src/Services/main.ts` passes the signal to `graph.invoke` and checks it again before persisting the turn. `invokeLLM` forwards LangGraph's `RunnableConfig.signal` to the Gemini chain. Translation chains pass the same signal to Gemini and rethrow cancellation instead of falling back to the untranslated/original text. Sarvam TTS receives the signal through Axios and also rethrows cancellation to the graph.
- Dependency inspection confirmed the installed LangChain `RunnableConfig` supports `signal`, LangGraph accepts an abort signal, and the Gemini chat model forwards it to its caller. The installed `PineconeStore.similaritySearch`/Ollama embedding interfaces do not expose a per-call signal, and the Neo4j driver calls have no wired cancellation here; those in-flight backend operations may continue after LangGraph stops waiting. Do not claim complete provider-side cancellation or cost avoidance for an abort during retrieval.
- `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the project Node 24 engine. No live client disconnect or provider/database request was run; no embeddings or index writes occurred.

## Latest completed work — make legacy ingestion scripts safe to import (2026-10-11)

- `Backend/src/data_saver.ts` and `Backend/src/kg_saver.ts` previously invoked their pipelines at module load. Importing `kg_saver.ts` could parse PDFs, call Gemini/Ollama, and write graph documents to Neo4j; importing `data_saver.ts` could scan/load the corpus and initialize legacy Pinecone components.
- Both scripts now use a CommonJS `require.main === module` entrypoint guard, so imports do not launch work. Direct execution of `kg_saver.ts` additionally requires an explicit `--execute`; otherwise it prints a warning and exits with status 2. The legacy graph writer remains unsafe for production ingestion even with the flag and is not run as part of the rewrite. `data_saver.ts` still has vector write calls commented and now logs truthfully that it performed no embedding/index writes.
- README documents the legacy-script boundary. No existing documents, graph records, vector index, or local corpus were read or changed by running these scripts; neither script was executed. This is import/entrypoint hardening, not a replacement ingestion pipeline.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the project Node 24 engine. No tests, provider/database calls, embeddings, or index writes were performed.

## Latest completed work — cache repeated query embeddings in memory (2026-10-11)

- Added `Backend/src/Services/cachedEmbeddings.ts` and switched the chat service's existing Ollama `nomic-embed-text` instance to `CachedOllamaEmbeddings`. The embedding model and query representation remain unchanged, preserving compatibility with the current dense index configuration; no document embeddings are generated by this cache change.
- Exact query strings are keyed by SHA-256 together with the model name. Completed finite, nonempty query vectors are held for five minutes in a 128-entry LRU cache; concurrent identical misses share one in-flight Ollama call. Cache hits return a copy of the vector so downstream code cannot mutate the retained value. Raw query text is not kept as a cache key.
- This applies to Pinecone's query embedding path and the optional legacy Neo4j query path because both use the exported embedding instance. The cache is process-local and cold on restart. It benefits only repeated identical queries within the TTL; it does not speed first-time queries or guarantee an overall response speedup. Cache hit rate and latency impact remain unmeasured.
- README now documents the TTL and capacity. Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the Node 24 engine. No tests, provider/database calls, document embeddings, or index writes were performed.

## Latest completed work — bound and configure factual-answer generation (2026-10-11)

- `Backend/src/config/env.ts` now validates `GEMINI_TEMPERATURE` in `[0, 2]` (default `0.2`) and `GEMINI_MAX_OUTPUT_TOKENS` in `[128, 8192]` (default `2048`). `initializeChatService.ts` passes both to `ChatGoogleGenerativeAI`; `.env.example` and README show the settings. This makes generation less variable by default and limits worst-case output size while retaining deployment overrides.
- These settings are reasoned defaults for a grounded factual assistant, not measured accuracy improvements. They have not been tuned against a judged MOSDAC answer set; a low output ceiling may truncate unusually detailed answers, so compare answer quality and latency before release.
- While updating `.env.example`, credential-looking values were found in its Gemini and Pinecone key fields and replaced with empty placeholders. The ignored local `Backend/.env` was not opened or changed. If those example-file values were active credentials, rotate them; they must not be committed or reused from the example file.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, an `awk` check confirming both example key fields are empty, and `git diff --check` passed. Node 26.5.0 warns against the declared Node 24 engine. No tests, provider requests, DB calls, embeddings, or index writes were performed.

## Latest completed work — check query-vector dimensions against Pinecone (2026-10-11)

- The startup path already lists Pinecone indexes read-only. `initializeChatService.ts` now finds the configured index record and fails clearly if it is missing, not dense, or does not report a positive integer dimension. It assigns that dimension to the active `CachedOllamaEmbeddings` instance.
- The active query model is now named once as `QUERY_EMBEDDING_MODEL` (`nomic-embed-text`). If Pinecone's index metadata reports an integrated embedding model, startup rejects a different model. If Pinecone omits model metadata (common for externally generated vectors), startup warns that model provenance cannot be checked from the index description.
- On the first actual query embedding, `CachedOllamaEmbeddings` compares Ollama's returned vector length with the configured Pinecone dimension before caching or passing it to the vector store. A typed `EmbeddingDimensionMismatchError` is rethrown through dense retrieval instead of being converted to an empty result that could look like an ordinary no-evidence answer.
- This catches reported model mismatches and incompatible dimensions without generating a startup probe or writing to the vector index. If model metadata is absent, matching dimensions still cannot establish vector-space compatibility; the original document-vector model needs provenance confirmation before swapping query providers.
- README documents the check and its limit. Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the declared Node 24 engine. No tests, Ollama/Pinecone requests, document embeddings, database changes, or index writes were performed.

## Latest completed work — add privacy-conscious RAG stage timings (2026-10-11)

- Added `Backend/src/utils/performanceLog.ts`, a small monotonic timer and structured JSON logger for stage durations.
- Instrumented query-variant retrieval, context packing, model generation, lazy chat-service initialization, chat-history loading, graph execution, history persistence, and whole-turn outcomes. Records include bounded counts and error class names to help identify latency and failure stages.
- The timing helper's contract excludes query text, prompts, answers, retrieved passages, session IDs, and other high-cardinality content. This is basic operational visibility, not a latency benchmark; there is no metrics backend or measured before/after result yet. Current logging uses `console.info` and should be routed/retained according to deployment logging policy.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the project's declared Node 24 engine. No tests, provider requests, database calls, embeddings, or index writes were performed.

## Latest completed work — remove misleading mock catalog and map screens (2026-10-11)

- Replaced `/data`'s hard-coded satellite dataset cards and inert search/filter/preview/download controls with a clear deferred-feature notice. Replaced `/map`'s sample satellite statuses, inert layer/draw/query controls, and placeholder map area with the same focused-release notice pattern. Both pages link back to chat.
- Added `astrolynx-chatbot Frontend/components/feature-unavailable.tsx` for a consistent accessible notice. Updated Phase 6 in `REWRITE_PLAN.md` to record that Data Explorer and Map routes are deferred, while the knowledge graph, voice, and unused mock/sidebar inventory remains unresolved.
- Verification: `CI=true pnpm typecheck:web`, `CI=true pnpm build:web`, and `git diff --check` passed. Next.js prerendered `/`, `/data`, and `/map`. Node 26.5.0 warns against the declared Node 24 engine. No tests, API calls, provider calls, embeddings, or index writes were performed.

## Latest completed work — bound MongoDB history reads without pruning data (2026-10-11)

- Replaced the chat history adapter's unbounded `findOne` read with a local implementation that uses MongoDB's `$slice` projection to fetch only the newest 200 stored messages for prompt construction. The existing LangChain stored-message format and append behavior are retained, so no historical messages are deleted or migrated.
- The endpoint already limits displayed history to 100 messages; README now records both bounds. The MongoDB session document can still grow without bound because writes are append-only. Capping or migrating writes requires a reviewed retention/data-preservation decision and remains outstanding.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. The first typecheck attempt exposed a MongoDB collection generic mismatch; it was corrected with an explicit session-document collection type and the rerun passed. Node 26.5.0 warns against the declared Node 24 engine. No tests, database calls, provider calls, embeddings, or index writes were performed.

## Latest completed work — stop persisting duplicate LangGraph turn checkpoints (2026-10-11)

- Removed the MongoDB LangGraph checkpointer from runtime initialization and graph compilation. Chat turns are request-scoped and already load/persist bounded conversation history in the existing MongoDB collection; no pause/resume feature consumes graph checkpoints. `main.ts` no longer passes a checkpoint thread ID or requires a checkpointer to serve chat.
- Removed the unused `@langchain/langgraph-checkpoint-mongodb` dependency and its environment setting. Existing checkpoint collection data has not been read, migrated, or deleted; it is now unused by the app and must be inventoried before any cleanup. MongoDB message history remains unbounded on writes, a separate persistence concern.
- This removes checkpoint writes that duplicated request state, including retrieval results and image payloads, and avoids checkpoint-store coupling in graph compilation. It is an architecture simplification; end-to-end latency and MongoDB storage impact have not been measured.
- Verification: lockfile updated with `pnpm install --lockfile-only --offline`; initial verification attempt caused pnpm to recreate `node_modules` and could not complete because registry access was unavailable. Dependencies were restored with approved network escalation, then `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the declared Node 24 engine. No tests, database calls, provider calls, embeddings, index writes, or checkpoint cleanup were performed.

## Latest completed work — remove unused Neo4j retrieval from the chat path (2026-10-11)

- Removed `retrieveFromNeo4j`, its LangGraph node/state field, and its conditional Neo4j runtime connection. The branch generated a query embedding and executed graph searches when enabled, but `neo4j_data` was not passed into context or the answer prompt; it added latency and provider/database coupling without informing answers.
- Removed the chat-only feature flag from validated config and `.env.example`. Left Neo4j credentials in the legacy config boundary for the explicit legacy graph-ingestion script; did not remove its dependency, run it, connect to Neo4j, or modify any external graph data.
- README and Phase 4 plan now state that graph retrieval stays out until an evaluated use case can produce traceable answer evidence. The dense chat path and optional BM25 path remain unchanged.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the declared Node 24 engine. No tests, provider/Neo4j calls, embeddings, or index/graph writes were performed.

## Latest completed work — separate Gemini system rules from RAG evidence (2026-10-11)

- `Backend/src/Services/ChatWithLLM.ts` now sends trusted behavior rules in a leading LangChain `SystemMessage`; the current evidence and current question are in the human turn, and prior messages remain separate history messages. The system rules explicitly treat retrieved source text and conversation history as untrusted data, limit history to resolving references, prohibit reusing old citation IDs/facts, and require abstention when current evidence is insufficient.
- Inspected the installed `@langchain/google-genai` implementation: it recognizes a leading system-role message and maps it to Gemini's `systemInstruction`. This is stronger instruction separation than placing all rules and evidence inside the same user message, but it is not proof against prompt injection or factual errors; evaluate with adversarial and gold MOSDAC questions before release.
- Updated the Phase 4 plan with this status and limitation. Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the declared Node 24 engine. No tests, Gemini requests, provider/database calls, embeddings, or index writes were performed.

## Latest completed work — clarify image grounding in the Gemini system rules (2026-10-11)

- Refined the system instruction to distinguish user-provided visual evidence from MOSDAC evidence. The model may describe directly visible image content without a source citation, but must not infer external/MOSDAC facts from the image alone; MOSDAC factual claims still require current-turn source IDs. When neither source passages nor visible image content supports an answer, the instruction directs an abstention.
- This aligns the prompt with the existing image-only request path, which intentionally allows an answer without retrieved citations. Prompt behavior remains unverified against real multimodal Gemini calls and needs adversarial/gold-set evaluation.
- Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the declared Node 24 engine. No tests, Gemini/provider calls, database calls, embeddings, or index writes were performed.

## Latest completed work — distinguish retrieval failure from no matching evidence (2026-10-11)

- Dense and optional lexical retrieval now return documents with source availability/error state. A Pinecone embedding-dimension mismatch remains a hard failure. If every configured retrieval source fails, the graph errors so the API returns a service failure; it no longer proceeds to generation and presents the infrastructure outage as ordinary lack of MOSDAC evidence.
- If one configured retriever fails while another completes, the completed retriever remains usable and the degraded source count/outcome is logged without query text or provider error messages. A successful search returning zero documents remains distinct from a failed search and follows the grounded abstention path.
- README and Phase 4 plan document the behavior. Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. Node 26.5.0 warns against the declared Node 24 engine. No tests or provider failure injection were run; no API/provider/database calls, embeddings, or index writes occurred.

## Latest completed work — preserve failed chat drafts for retry (2026-10-11)

- Normal chat sends now keep the text and selected image in the composer until the server returns a valid assistant response. On a failed HTTP/network/response-shape request, the unsaved optimistic user turn is removed and a concise error remains by the composer; the original draft remains available for retry. On success, the draft is cleared. New Chat also clears this transient error.
- Audio-mode send handling remains a separate legacy path and was not changed by this edit.
- Updated Phase 5 status. Verification: `CI=true pnpm typecheck:web`, `CI=true pnpm build:web`, and `git diff --check` passed; Next.js prerendered all routes. Node 26.5.0 warns against the declared Node 24 engine. No API/network calls or tests were run.

## Latest completed work — move new chat messages to an additive per-message collection (2026-10-11)

- Added `MONGO_MESSAGES_COLLECTION_NAME` (default `astrolynx_chat_messages_v2`) and an indexed MongoDB collection storing each newly written LangChain message as its own document with `sessionId`, message payload, and timestamp. Prompt-memory reads and the history API combine the recent legacy embedded messages with recent appended records; prompt reads remain capped at 200 and API history at 100.
- New turns no longer append to the legacy one-document-per-session array, avoiding continued growth toward MongoDB's 16 MB document ceiling. Existing session documents are read without migration, update, or deletion; no bulk migration or external database call was run. Deployments should avoid old and new writers serving the same sessions simultaneously because old-format writes cannot be totally ordered against new records. Retention/backups and multi-instance ordering still require operations review.
- `.env.example`, README, and Phase 2 status document the collection and additive compatibility behavior. Verification: `CI=true pnpm typecheck:api`, `CI=true pnpm build:api`, and `git diff --check` passed. The first typecheck caught a role-union inference issue in the history serializer; its corrected rerun passed. Node 26.5.0 warns against the declared Node 24 engine. No tests, MongoDB/provider calls, embeddings, or index writes occurred.

## Latest completed work — inspect local setup and confirm shadcn UI baseline (2026-10-11)

- Confirmed `Backend/.env` exists and contains nonblank values for the current chat path's MongoDB URI/database/legacy collection, Gemini API key, Pinecone API key/index, Ollama base URL, and server settings. Values were not printed. The blank entries are `SARVAM_AI_API_KEY` (optional voice service), `MOSDAC_BROWSER_EXECUTABLE_PATH` (optional rendered crawling), `MOSDAC_LEXICAL_INDEX_PATH` (optional BM25 sidecar; unset means dense-only retrieval), and `PINECONE_ENVIRONMENT` (legacy/unused by current Pinecone client). `MONGO_MESSAGES_COLLECTION_NAME` is omitted and uses its safe default. Neo4j credentials are present but chat retrieval no longer uses them.
- Confirmed local Ollama lists `nomic-embed-text:latest`, the query embedding model expected by the existing dense index path. This checks local model availability only; no embedding was generated and no Pinecone index/provider request was made.
- `astrolynx-chatbot Frontend/components.json` already configures shadcn/ui, and the repo has shadcn-style UI components. `astrolynx-chatbot Frontend/.env.local` is absent; local development falls back to `http://localhost:5000`. Set `NEXT_PUBLIC_API_BASE_URL` there only when the API runs at a different origin; production frontend builds/deployments need the deployed API origin configured at build time.
- Attempted `CI=true pnpm build:web` in the sandbox and with escalation. Both stopped when Turbopack's CSS/PostCSS worker attempted to bind a local port and received `Operation not permitted`; this is an environment-level build blocker, so the current Next 16 production build is not yet verified. The commands also warn that this shell runs Node 26.5.0 while the project pins Node 24. No tests, API/provider calls, embeddings, or index writes were performed.

## Latest completed work — remove serial language translation from RAG (2026-10-11)

- Removed the graph's input and output translation nodes and deleted `Backend/src/Services/translateText.ts`. Retrieval and generation now receive the original user wording; generation receives the selected response-language instruction directly. The API already validates supported response-language codes (`en`, `hi`, `hi-en`, `es`, `fr`, `de`), and deterministic greetings now have localized strings. No serial translation model request is made. TTS still receives the selected language for spoken replies.
- This follows the user's direction to avoid the old translation-chain workaround. It reduces serial model calls for non-English responses and preserves citations through the single grounded generation call. This is an architectural/call-count change, not a measured latency or language-quality result.
- Important retrieval limit: the current local `nomic-embed-text:latest` Ollama model is the v1.5 model; its [Hugging Face card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) is tagged English. Sending Hindi/Hinglish directly avoids translation but does not establish cross-lingual retrieval quality against the current English-heavy Pinecone index. We did not switch embedding models or re-embed documents because the user explicitly wants to defer embeddings. Before claiming accurate Hindi/Hinglish RAG, directly evaluate multilingual queries; if recall is inadequate, the durable fix is a compatible multilingual model for both indexed passages and queries, which requires a planned same-space re-index. A different query embedding model cannot safely be substituted based only on matching dimension.
- Traced the microphone path for the user's Whisper idea: both UI microphone controls use browser `SpeechRecognition`/`webkitSpeechRecognition` and set `lang = "en-US"`; recognized text is sent to chat. The backend does not run Whisper. `Backend/src/Services/textToSpeech.ts` calls Sarvam's TTS API for generated audio. Hugging Face model cards reviewed: [DKube Hinglish Whisper 0.8B](https://huggingface.co/dkubeio/DKube-asr-hinglish-v1-0.8B) is a standalone Whisper large-v3-turbo fine-tune, but its author labels it a prototype with a small single-domain corpus and only a 40-clip reported evaluation; [Whisper-tiny Hinglish](https://huggingface.co/abhishekgautamm/whisper-tiny-hinglish) is a 39M CPU/edge option with Romanized output and stated domain/noise limitations. They are candidates to benchmark, not production-approved choices. Both currently show no Hugging Face Inference Provider deployment, so integration would require self-hosting/model serving or choosing a separately hosted endpoint. Replacing browser recognition would require capturing raw audio (e.g. MediaRecorder), an upload/transcription API, audio duration/size limits, and an ASR runtime; this is not implemented.
- Verification: `Backend/node_modules/.bin/tsc --noEmit -p tsconfig.json`, API TypeScript emit build, frontend TypeScript check, frontend ESLint, `CI=true ./node_modules/.bin/next build --webpack`, and `git diff --check` passed. Next's default Turbopack build still hit the sandbox's local-port restriction; webpack production build compiled and prerendered `/`, `/data`, and `/map`. The first workspace typecheck was blocked by `Backend/tsconfig.json` using unsupported `ignoreDeprecations: "6.0"` with TypeScript 5.9.3; changed it to the supported `"5.0"`, after which direct API typecheck/build passed. Next.js added the required `react-jsx` setting and `.next/dev/types` include to the frontend tsconfig during its successful build. No tests, Gemini/Mongo/Pinecone/Sarvam requests, transcription, embeddings, or index writes were performed.
- Files changed for this phase: `Backend/src/Services/ChatWithLLM.ts`, `Backend/src/Services/LangGraphChain.ts`, deleted `Backend/src/Services/translateText.ts`, `Backend/tsconfig.json`, `astrolynx-chatbot Frontend/components/chat-interface.tsx`, `astrolynx-chatbot Frontend/tsconfig.json`, `README.md`, `REWRITE_PLAN.md`, and `workdone.md`.

## Latest completed work — skip generation when retrieval has no evidence (2026-10-11)

- `Backend/src/Services/ChatWithLLM.ts` now immediately returns a deterministic no-evidence abstention when the turn has no current citations and no user image. The path does not invoke Gemini for answer generation, and it records `answer_generation` as `abstained` with reason `no_evidence` in stage timing. Image-only turns still go through Gemini so directly visible image details can be described.
- Replaced English-only abstention phrase detection in citation validation. An answer with available source citations but no valid citation marker now receives a localized grounding fallback; any citation ID not present in the current evidence receives the same safe fallback. Generation errors also use the selected response language. Fallback strings are explicit for English, Hindi, Hinglish, Spanish, French, and German.
- This reduces one model call on true no-evidence turns and guarantees that empty retrieval cannot be mistaken for an invitation to generate MOSDAC facts. It does not prove that a valid cited source entails each claim; answer support remains an evaluation requirement.
- Updated README and Phase 4 plan with the behavior and its limits. Verification: `Backend/node_modules/.bin/tsc --noEmit -p tsconfig.json`, `Backend/node_modules/.bin/tsc -p tsconfig.json`, and `git diff --check` passed. No tests, Gemini/provider calls, DB calls, embeddings, or index writes were performed.
- Files changed for this phase: `Backend/src/Services/ChatWithLLM.ts`, `README.md`, `REWRITE_PLAN.md`, and `workdone.md`.

## Latest completed work — omit unverified citations on rejected answers (2026-10-11)

- Citation-validation fallbacks in `ChatWithLLM.ts` now clear `citations` from the graph state. `main.chat()` therefore does not attach candidate sources or a source footer to an answer explicitly rejected as unsupported or missing valid citation IDs.
- Answer-generation timing now reports `rejected` with a bounded reason (`unsupported_citation` or `missing_citation`) rather than incorrectly recording these outputs as completed generations. Successful validated answers remain `completed`; empty-evidence abstentions use `abstained`.
- Updated README and Phase 4 plan. Verification: API TypeScript no-emit check, API TypeScript build, and `git diff --check` passed. No tests, provider/database calls, embeddings, or index writes were performed.
- Files changed for this phase: `Backend/src/Services/ChatWithLLM.ts`, `README.md`, `REWRITE_PLAN.md`, and `workdone.md`.

## Latest completed work — include dense scores in retrieval diagnostics (2026-10-11)

- Dense Pinecone retrieval now retains the scores returned by `similaritySearchWithScore` alongside its bounded, short-lived cached documents. Search timing records the finite score count, minimum, maximum, and mean for normal requests, coalesced requests, and cache hits.
- Removed a separate score “stage” that reused the search start time and could report a misleading duration. No score threshold was added and the scores do not affect filtering, RRF ranking, or answer generation; Pinecone metric values are diagnostic and are not calibrated relevance probabilities.
- Verification: `CI=true pnpm typecheck:api` completed without TypeScript errors; `git diff --check` passed. pnpm warns that the host is Node 26.5.0 while the workspace requests Node 24. No tests, provider/database calls, embeddings, or index writes were performed.
- Files changed for this phase: `Backend/src/Services/Retrival.ts` and `workdone.md`.

## RAG performance review — context token counting (2026-10-11)

- Traced `buildContext`'s `chatLLM.getNumTokens` calls to the installed `@langchain/core` implementation. It uses the local `js-tiktoken` encoding when available and falls back to a local character-based estimate if tokenizer loading/counting fails; this path does not call Gemini's remote token-count API.
- No implementation change was warranted. Context packing still makes multiple local tokenization passes (binary search over at most six ranked passages), but this is bounded and avoids repeated full-prefix counting. The configured 4,000-token context cap is therefore an estimate of text tokens, not a complete count of message overhead or attached image tokens.
- Evidence inspected: `Backend/node_modules/@langchain/core/dist/language_models/base.js` (`BaseLanguageModel.getNumTokens`) and `Backend/src/Services/Memory.ts` (`buildContext`). No provider calls, DB calls, tests, embeddings, or index writes were performed.

## UI review — grounded citation presentation (2026-10-11)

- Traced assistant message rendering in `astrolynx-chatbot Frontend/components/chat-interface.tsx`: inline `[S#]` markers remain in the Markdown answer, while the generated `Sources:` footer is replaced by a structured “Retrieved sources” list with title, page, section, and source. An “open source” link is shown only when the API supplies a validated MOSDAC HTTPS URL.
- No UI code change was warranted by this focused review. A lexical result sourced only from a local PDF path will be displayed as plain source text and will not have an open link; this is one reason the partial local BM25 sample remains unconfigured.
- Evidence inspected: `Backend/src/Services/Memory.ts` citation construction, `Backend/src/Controllers/sessionController.ts` history-footer parsing and URL validation, and the chat component rendering. No UI build or tests were run in this review.

## Latest completed work — over-fetch dense candidates before quality screening (2026-10-11)

- Pinecone now retrieves at most 40 dense candidates per query before source-provenance and extracted-text quality checks; BM25 remains at 20 candidates. Both paths still return at most eight readable documents per query into reciprocal-rank fusion and context packing.
- This addresses a recall failure mode in a legacy index containing noisy extracted chunks: filtering only 20 nearest results could leave too few usable passages even if readable evidence ranked just below them. The retrieval remains bounded, and no score cutoff or index mutation was added.
- This is a code-level recall opportunity, not a measured accuracy improvement. Returning more Pinecone matches may increase response payload/latency; the production index has not been queried to measure retained-readable counts or p50/p95. A representative reviewed set and live-safe latency measurement are still needed before tuning further.
- Verification: `CI=true pnpm typecheck:api` and `git diff --check` passed. The host is Node 26.5.0 while the workspace requests Node 24. No tests, provider calls, DB calls, embeddings, or index writes were performed.
- Files changed for this phase: `Backend/src/Services/Retrival.ts`, `REWRITE_PLAN.md`, and `workdone.md`.

## Latest completed work — close Markdown citation-presence gaps (2026-10-11)

- Answer validation now checks every Markdown list item separately, so one cited bullet cannot satisfy validation for neighboring uncited bullets. It also removes heading lines before validation instead of skipping the entire paragraph when it begins with a heading; a factual body under a heading must still have a citation.
- The generation instructions now ask for citations on each factual list item. Ordinary prose retains the existing paragraph-level marker check. This is still only a citation-presence check: a valid marker does not establish that the cited passage supports the claim, and sentence-level entailment remains unverified.
- Verification: `CI=true pnpm typecheck:api` and `git diff --check` passed. No tests, provider/database calls, embeddings, or index writes were performed; pnpm warns that the host is Node 26.5.0 while the workspace requests Node 24.
- Files changed for this phase: `Backend/src/Services/ChatWithLLM.ts`, `REWRITE_PLAN.md`, and `workdone.md`.

## Documentation correction — dense retrieval candidate count (2026-10-11)

- Updated the README's RAG overview from 20 to 40 Pinecone candidates and noted that the larger pool is bounded but not yet benchmarked against the production index. The eight-passage return cap is unchanged.
- Checked with `git diff --check`; no code, provider calls, tests, embeddings, or index writes were involved.
- Files changed: `README.md` and `workdone.md`.

## RAG review — query embedding cache compatibility (2026-10-11)

- Inspected `Backend/src/Services/cachedEmbeddings.ts` and startup wiring. The cache key includes embedding model and exact query text; cached vectors expire after five minutes, use a 128-entry LRU cap, and are returned as copies. Empty/non-finite vectors are not cached. Startup clears cached vectors when the Pinecone dimension changes, and each newly computed vector is checked against that dimension before caching. Failures are not cached, and concurrent identical queries are coalesced.
- No code change was warranted. This protects query-vector reuse, but it cannot prove that historical document vectors were made with the same model when Pinecone omits model metadata; startup already warns about that uncertainty. No provider calls, tests, embeddings, or index writes were performed.

## Latest completed work — fix local API origin and hydration mismatch (2026-10-11)

- Browser logs showed requests to `localhost:5000` receiving 403 without CORS headers. `lsof` identified the listener on port 5000 as macOS `ControlCenter`, not AstroLynx. Moved the local API default to port 5001 in validated config, `Backend/.env.example`, and the user's existing `Backend/.env`; changed the frontend fallback and its `.env.example` to `http://localhost:5001`. The trusted frontend CORS origin remains `http://localhost:3000`.
- Made the New Chat button's initial `disabled` value deterministic across server render and first client hydration by gating it on a `hasMounted` state that changes in `useEffect`. It becomes disabled while session setup is in progress after mount.
- Updated README local ports. Frontend typecheck and lint passed with `PNPM_STORE_DIR=/Users/raven/Library/pnpm/store/v11 CI=true pnpm typecheck:web` and `... pnpm lint:web`. `git diff --check` passed. Started the API with `pnpm dev:api`; it reported listening on 5001. A local health request returned 200 and a CORS preflight from `http://localhost:3000` returned 204 with `Access-Control-Allow-Origin: http://localhost:3000` (the local request required elevated network permission). The API process was left running on port 5001 for the user's local session.
- The browser's “Speech Recognition API is not supported” messages are informational: the UI already handles unsupported browser speech by disabling microphone controls; text chat remains available. No MongoDB/Gemini/Pinecone/Ollama chat query was made.
- Initial typecheck attempt triggered pnpm's default-store repair and failed on network DNS; stopped it and restored dependencies from the existing local pnpm store. Corrected `Backend/tsconfig.json` from `ignoreDeprecations: "6.0"` to `"5.0"` for the installed TypeScript 5.9.3; API typecheck then passed. pnpm warns the host is Node 26.5.0 while the workspace requests Node 24.
- Files changed: `Backend/.env`, `Backend/.env.example`, `Backend/src/config/env.ts`, `Backend/tsconfig.json`, `astrolynx-chatbot Frontend/components/chat-interface.tsx`, `astrolynx-chatbot Frontend/.env.example`, `README.md`, and `workdone.md`.
- Follow-up from the first live UI request: the API is now reached on port 5001, but MongoDB Atlas returned authentication error code 8000. A read-only ping confirmed DNS/network access and rejected the configured credentials; no URI or password was printed. `initializeChatService.ts` now emits a specific, secret-free hint for MongoDB auth codes 8000/18. The credential itself must be corrected by the user in `Backend/.env`; URL-encode special characters in the URI username/password. API typecheck passed after the TypeScript deprecation-setting correction. No chat answer can complete until the DB credential is valid.

## Latest completed work — initialize Mongo storage for chat-history requests (2026-10-11)

- Rechecked MongoDB after the user's latest report: the configured Atlas database now accepts a read-only ping. This resolves the earlier authentication failure; credentials were not printed.
- Fixed the actual history 500: `getChatHistory` accessed Mongo collections before any chat request had initialized them. Extracted a shared, concurrency-safe Mongo-only storage initializer and invoke it from the history endpoint. It does not initialize Gemini or Pinecone, so loading prior messages does not need unrelated providers.
- Added a React Strict Mode guard so development's simulated effect replay does not issue the same initial session/history request twice.
- Restarted the API on port 5001 and requested `/api/session/history/<valid UUID>` with the allowed frontend origin. It returned HTTP 200, `history: []`, and `Access-Control-Allow-Origin: http://localhost:3000`; no message documents were written or modified.
- Verification passed: API TypeScript check, frontend TypeScript check, frontend ESLint (zero warnings), and `git diff --check`. No tests or chat/LLM/vector search calls were made. Node 26.5.0 still warns against the declared Node 24 engine.
- The API process was left running on port 5001. Existing frontend sessions should reload and retry history. A live MOSDAC answer has not been tested; that requires a chat request and would call the configured LLM/vector providers.
- Files changed: `Backend/src/Services/initializeChatService.ts`, `Backend/src/Controllers/sessionController.ts`, `astrolynx-chatbot Frontend/components/chat-interface.tsx`, and `workdone.md`.

## Latest completed work — retain cited answer units when generation has uncited filler (2026-10-11)

- Reviewed the user's live “What is INSAT-3D used for?” trace: embedding and Pinecone retrieval succeeded (40 candidates fetched, 15 passed text/provenance screening, 8 returned, 6 packed); answer generation took about 5.9 seconds and was rejected only as `uncited_paragraph`. Thus the fallback was caused by citation-format validation, not an empty retrieval or provider failure.
- Changed answer handling: unsupported citation IDs still reject the entire answer; if valid citations are present, uncited prose paragraphs and uncited Markdown list items are removed while cited paragraphs/items remain. If no cited content remains, the localized grounding fallback still applies. The API now returns only citations referenced by retained answer content. Citation markers inside code are not counted. Image-only answers without document citations retain their generated text.
- This avoids replacing an answer's cited content with a fallback merely because the model also emitted an uncited preamble or extra paragraph. It does not verify that a citation entails each claim inside a cited paragraph/list item; independent answer-support evaluation is still required.
- Verification: direct API/frontend TypeScript checks, frontend ESLint, and `git diff --check` passed. No additional Gemini/Pinecone query was sent; therefore the exact user query has not yet been confirmed against this revised validator.
- Files changed: `Backend/src/Services/ChatWithLLM.ts`, `REWRITE_PLAN.md`, and `workdone.md`.

## Latest completed work — keep chat generation running when switching conversations (2026-10-11)

- Fixed the frontend behavior where selecting another conversation aborted the current `/api/chat` fetch. Because the API ties its request-abort signal to the HTTP response connection, aborting that fetch also stopped backend generation.
- Conversation selection and New Chat now leave chat requests connected. Controllers are tracked as a set so several requests can finish independently; unmount still aborts outstanding work, and explicitly closing audio mode can still cancel its own audio request.
- Each normal chat request captures its originating session ID. On completion, the UI reloads that session's persisted history only if it is currently selected. If the user is in a different chat, completion does not append into or clear state belonging to that chat; returning to the origin loads the saved answer. Failures are likewise scoped to the originating session.
- History loads now verify the selected session both before applying results and before showing errors, preventing a slow response for an old selection from overwriting the currently open conversation. Typing state is reset when switching sessions so the new chat remains usable while the earlier request finishes.
- Verification: frontend TypeScript check passed, frontend ESLint passed with zero warnings, and `git diff --check` passed. An initial ESLint run flagged the audio handler's use of a later-declared history callback; changed audio completion to append only to the currently active conversation and reran lint successfully.
- No backend cancellation code, test suite, or external chat provider was invoked. Files changed: `astrolynx-chatbot Frontend/components/chat-interface.tsx` and `workdone.md`.

## Latest completed work — expose Gemini generation failures and shorten retry delays (2026-10-11)

- Investigated a user-reported MOSDAC turn where retrieval and context packing succeeded, but Gemini generation failed after 79.9 seconds and the UI returned the generic generation fallback. The trace contains no provider error details, so it does not establish whether the cause was rate limiting, timeout, quota, malformed request/history, or a provider outage.
- The installed `@langchain/google-genai` adapter was configured without an explicit retry limit. Set `maxRetries: 1` on the chat model to retain one retry for transient failures without the adapter's long default retry cascade.
- Added bounded, credential-scrubbed provider diagnostics in the generation error log and performance event: exception type, message (up to 300 characters), and status/code when available. API keys/token/authorization values are redacted; request headers and response bodies are not logged. This should make the next failure class visible without exposing credentials.
- Verification: API TypeScript check and `git diff --check` passed. No Gemini/Pinecone request or tests were run. Google’s current model documentation lists `gemini-3.5-flash` as deprecated and automatically routed to `gemini-3.6-flash`; this alias is not enough evidence to attribute this specific error, and the configured model was left unchanged pending a real provider error. Source: [Gemini 3.5 Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash).
- Files changed: `Backend/src/Services/initializeChatService.ts`, `Backend/src/Services/ChatWithLLM.ts`, and `workdone.md`.

## Latest completed work — log raw Gemini output (2026-10-11)

- Added a `[Gemini raw output]` log immediately after the model returns and before citation validation, filtering, or fallback handling. This shows whether Gemini returned empty text, an uncited response, unexpected formatting, or a usable answer.
- The log includes only the model's returned text; it does not print the prompt, chat history, or retrieved source context. Generated text may still contain content from the user's question, so it will be retained wherever backend stdout/stderr logs are stored.
- Verification: API TypeScript check and `git diff --check` passed. No Gemini request was made. Files changed: `Backend/src/Services/ChatWithLLM.ts` and `workdone.md`.

## Latest completed work — preserve paragraphs with grouped citations (2026-10-11)

- Compared the user's `[Gemini raw output]` log with the rendered chat screenshot. Gemini returned two introductory paragraphs with grouped citations such as `[S1, S2, S4, S5]`, followed by individually cited list items. The screen showed only the list.
- Root cause: citation validation matched only the exact form `[S1]`. Grouped markers were therefore treated as uncited, and the citation-grounding filter pruned the introductory paragraphs while retaining the list items.
- Updated citation extraction to recognize comma-separated source IDs inside one marker and validate each ID against the evidence set. Updated the UI's source-marker removal regex to remove whole grouped markers too, so it will not leave citation fragments behind.
- Verification: API TypeScript check, frontend TypeScript check, and `git diff --check` passed. No live model request or tests were run. Previously saved assistant messages have already been persisted after pruning and will not regain omitted paragraphs; new answers use the corrected validator.
- Files changed: `Backend/src/Services/ChatWithLLM.ts`, `astrolynx-chatbot Frontend/components/chat-interface.tsx`, and `workdone.md`.

## Latest completed work — answer assistant identity questions without MOSDAC retrieval (2026-10-11)

- The user reported that “tell more about yourself” returned the grounded-answer fallback. The classifier previously sent every non-greeting question into MOSDAC retrieval, so a question about AstroLynx itself could only pass if unrelated source chunks happened to support it.
- Added lightweight recognition for common English, Hinglish, and Hindi assistant-directed questions and route them to a separate conversational Gemini node, without MOSDAC retrieval or citation requirements. The model generates the actual response from an instruction describing AstroLynx's role, capabilities, and limits; the answer is not a fixed string. The selected response language is passed to the model.
- MOSDAC factual questions remain on the retrieval and citation-validation path. The new conversational node handles provider failures with the existing localized generation fallback and logs safe provider error details.
- Verification: API TypeScript check and `git diff --check` passed. No Gemini request was made. Files changed: `Backend/src/Services/Retrival.ts`, `Backend/src/Services/LangGraphChain.ts`, `Backend/src/Services/ChatWithLLM.ts`, and `workdone.md`.

## Latest completed work — write new-device setup and run guide (2026-10-11)

- Added `RUN.md` with Node 24/pnpm setup, clone/install commands, backend/frontend environment configuration, required MongoDB/Gemini/Pinecone/Ollama dependencies, `nomic-embed-text` setup, two-terminal development startup, health check, account signup, troubleshooting, verification commands, and new-device credential/data handoff checklist.
- Clarified that starting the web/API process does not establish provider readiness, and that useful grounded answers require access to the existing populated, embedding-compatible Pinecone index; the guide explicitly avoids suggesting an unreviewed re-embed.
- Corrected `Backend/.env.example` so unused Neo4j settings are blank (the validator requires all-or-none configuration) and the message collection setting uses the actual `MONGO_MESSAGES_COLLECTION_NAME` variable. Added a README link to the new run guide.
- Verification: `git diff --check` passed. No services, migrations, embeddings, or tests were run.
- Files changed: `RUN.md`, `Backend/.env.example`, `README.md`, and `workdone.md`.

## Latest completed work — add one-command Docker Compose stack (2026-10-16)

- Added `docker-compose.yml` with a local MongoDB container, Ollama server, one-shot `nomic-embed-text` model pull, compiled API container, and compiled Next.js web container. Startup dependencies wait for MongoDB/Ollama health, model download completion, and API health in order.
- Added API and frontend Dockerfiles using the workspace's Node 24 and pnpm 11.5.3 versions, plus `.dockerignore` exclusions for secrets, dependencies, generated outputs, private corpus files, references, and screenshots.
- Published only localhost ports 27017, 5001, and 3000. Compose uses persistent named volumes for MongoDB and Ollama. Normal `docker compose down` retains both; `down --volumes` is documented as a data/model destructive reset. Gemini and Pinecone remain external and are configured through `Backend/.env`.
- Expanded `RUN.md` with `docker compose up --build -d`, `docker compose down`, logs/status checks, first-run model download behavior, persistent-volume notes, and the distinction between Docker and native setup. Docker route requires no host Node/pnpm/MongoDB/Ollama installation. The API environment example was already normalized in the prior setup-guide work.
- Validation: `docker compose config --quiet` and `git diff --check` both passed. No image builds, containers, database writes, or provider requests were run.
- Files changed: `docker-compose.yml`, `Backend/Dockerfile`, `astrolynx-chatbot Frontend/Dockerfile`, `.dockerignore`, `RUN.md`, and `workdone.md`.

## How to continue safely

- Read `REWRITE_PLAN.md` and this log before making changes.
- Update the status and exact file list here whenever work is completed; record commands/checks and their outcomes, including failures.
- Preserve `Backend/downloaded_docs/`, `Backend/mosac-data/`, `.git`, and `references/` unless the user explicitly authorizes destructive cleanup after a data inventory.
- Never run the legacy crawler, `data_saver.ts`, or `kg_saver.ts` as a validation shortcut: they have side effects and the ingestion quality problem is not solved.
- Do not embed the whole historical corpus until a dry-run report and labeled PDF quality evaluation are in place.
- When a task needs a provider/graph/data-preservation choice, keep progress on independent work and record the decision needed instead of guessing.
