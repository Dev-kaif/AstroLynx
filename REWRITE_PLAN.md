# AstroLynx Rewrite Plan

## Goal

Rebuild AstroLynx as a reliable MOSDAC assistant with a working chat experience, dependable document ingestion, traceable answers, and a setup that a new developer can reproduce. Treat the current repository as a product prototype and reference for useful behavior, not as a production foundation.

## Product and architecture decisions

1. **Ship a focused assistant first.** The first complete release is chat plus document grounded answers, citations, session history, and English/Hindi support. Data Explorer, live maps, analytics, and voice mode stay out of the release until they have real data sources and working interactions.
2. **Use a modular monolith.** Keep a Next.js frontend and a TypeScript API in one repository. Separate API, domain, persistence, retrieval, and ingestion modules. Avoid microservices until there is a real scaling or ownership need.
3. **Reduce retrieval infrastructure.** Start with MongoDB for sessions and ingestion metadata, and one vector store for document search. Keep Neo4j only if graph questions are a required product feature and a real graph retrieval/indexing design is validated. Do not operate both vector and graph stores just to preserve the old architecture.
4. **Treat source documents as the source of truth.** Ingestion must be repeatable and versioned. Every retrieved passage must retain its document title, source URL/file, page or section, and ingestion version so answers can cite it.
5. **Use supported versions at implementation time.** Refresh framework and AI SDK versions deliberately, with lockfiles and migration notes. Don’t rely on `latest` dependency ranges or suppress type/build failures.

## Current implementation baseline

The detailed change history, exact commands, crawl findings, corpus sample, and next actions are maintained in [`workdone.md`](./workdone.md). As of 2026-10-10, the codebase has a root pnpm workspace; bounded PDF/corpus inspection and a read-only, stable-ID PDF chunk planner with aggregate 2,000-page/1-GiB/200,000-estimated-token defaults; a resumable MOSDAC static crawler with opt-in Playwright rendering; a structured radar/satellite table adapter; and RSS entries with stable IDs, durable per-entry manifests/upserts, inactive marking without deletion, and preview-asset separation. The ISROCast path was checked against one fresh live response (25 entries) and a second refresh (25 unchanged). Browser rendering has an aggregate encoded-byte cancellation trigger and a reserve margin; a live 250 KB cap check stayed below the configured cap at 150,237 bytes, but unknown-length responses are not proven to stay within a strict byte ceiling. Page-text quality remains provisional. A read-only sample covers the first eight pages of all 56 local PDFs. The API now validates chat payloads and UUIDs, applies an 8 MB JSON limit, and the frontend API base URL is configurable.

The legacy chat path has only been narrowed, not replaced: it runs one original-query dense search by default, screens results for readable text and source provenance, and exposes source IDs/citations. An optional local BM25 sidecar now runs in parallel with dense search and fuses rankings, but remains disabled without an explicitly configured, reviewed sidecar. Its evaluator has been exercised against a 346-chunk partial PDF sample and a 10-query self-authored provisional set (hit rate@5 1.00, MRR 0.778, nDCG@5 0.824); this is a wiring diagnostic, not a MOSDAC gold benchmark. Hindi BM25 tokenization retains combining marks, and deterministic follow-up anchoring recognizes common non-English references. Query vectors and dense results have bounded short-lived caches with privacy-safe timing logs. Answer generation rejects paragraphs that contain no current-turn citation when evidence exists, but this does not verify semantic entailment. Neo4j is disabled by default pending evidence of value. The current path still uses MongoDB, Gemini, Pinecone, Ollama, LangGraph, and old persistence code. There is no quality-approved production index, calibrated reranker/abstention, source migration, or measured end-to-end latency/answer-quality benchmark yet. Do not represent the scaffolding or reduced call count as a completed RAG rewrite.

## Target structure

```text
apps/
  web/                 Next.js UI and typed API client
  api/                 HTTP API, validation, orchestration
packages/
  contracts/           Shared request/response schemas and types
  retrieval/           Chunking, embeddings, indexing, retrieval, citations
  ingestion/           Crawl/import jobs and document parsers
  config/              Validated server configuration
infra/
  compose.yaml         Local MongoDB and Ollama only if needed
docs/
  architecture.md
  operations.md
```

Keep UI primitives close to the frontend; remove unused generated UI and mock components as part of cleanup. If a monorepo adds unnecessary friction, preserve the same module boundaries in the existing `Backend/` and frontend folders rather than changing structure for its own sake.

## Phases

### Phase 0 — Lock down scope and preserve useful behavior

- Confirm the first-release language, supported document formats, and whether knowledge graph answers are actually required.
- Record the current endpoints, request/response shapes, prompt behavior, and useful visual components.
- Identify existing indexed data and whether any external database contains production data that must be preserved.
- Make a migration inventory: keep, replace, archive, or delete for each current module.

**Complete when:** there is an agreed first-release scope and a safe inventory of data/services before anything is migrated or removed.

### Phase 1 — Create a reproducible foundation

- Choose one package manager strategy and add a root workspace with scripts for web, API, ingestion, linting, type-checking, and builds.
- Pin supported Node and package-manager versions; refresh dependencies as a reviewed set and commit lockfiles.
- Add validated environment configuration with clear required/optional variables and startup errors that name missing settings.
- Add `.env.example` files without secrets, correct setup instructions, and local service configuration.
- Fix the root layout and metadata conventions; remove duplicated starfield rendering.
- Remove build settings that ignore type errors and lint failures.

**Complete when:** a clean checkout can install and build using documented commands, with no credentials required for the UI-only development path.

### Phase 2 — Define the API and persistence model

**Current status:** MongoDB chat history remains the conversational source of truth. New messages are appended to a separate per-message collection with a session/time index; reads merge these records with legacy embedded session messages, leaving old documents intact. New writes no longer enlarge the legacy session document. Graph checkpoints are not used because there is no pause/resume flow; existing checkpoint collections remain untouched. Retention, backup policy, multi-instance ordering, and authenticated session ownership still need release-level decisions and verification.

- Define shared, runtime-validated schemas for chat requests, assistant responses, citations, sessions, and history.
- Require a valid session identifier and non-empty text or image input; return consistent error objects.
- Replace the implicit MongoDB message shape with an explicit model: one record per message or one session document, consistently used for writes and history reads.
- Store user/assistant role, content, timestamps, attachments metadata, and citations consistently.
- Decide one source of truth for conversation history. Keep graph checkpoints only if they add needed resumability; otherwise use bounded per-turn state and persisted message history.
- Add pagination/limits to history endpoints and prevent callers from fetching arbitrary sessions without authorization or a sufficiently scoped session token.

**Complete when:** chat, new-session, and history endpoints share one documented contract and can round-trip a conversation without duplication or loss.

### Phase 3 — Rebuild document ingestion

- Define supported inputs and source identity: MOSDAC pages, PDFs, and any explicitly selected office formats.
- **Use official MOSDAC interfaces before crawling pages.** Build separate adapters for public catalog metadata, published RSS feeds, technical-document links, and the documented MOSDAC Data Download API. MOSDAC documents catalog search and data download separately: catalog search can be used without login, while granule downloads require MOSDAC credentials. Keep RAG ingestion of public documentation/catalog metadata separate from user-authorized satellite data downloads. Do not scrape around authentication or reverse-engineer undocumented/private APIs.
- **Discover sources deliberately.** Seed from approved catalog pages and official feeds/sitemaps, then follow only approved same-host links and known document types. Maintain a source registry with adapter, URL, crawl schedule, content type, and whether login is required. Support satellite and radar catalog sources independently because their page structures differ.
- Normalize and validate URLs; constrain crawling to exact approved hostnames, check MOSDAC's current crawl/access policies, obey crawl limits, and record failures rather than silently dropping content. Preserve meaningful query parameters; remove tracking parameters only from canonical IDs.
- Implement a polite, resumable fetch queue with per-host concurrency and rate limits, request timeouts, retry with exponential backoff and jitter for transient errors, `Retry-After` handling, and a circuit breaker for repeated failures. Use conditional requests (`ETag`/`Last-Modified`) where supported and never put credentials or tokens in logged URLs.
- Validate response status, content type, and file signature before parsing. Enforce configurable file-size and page-count limits, safe filenames, redirect/domain checks, and clear outcomes for unsupported or oversized files. Avoid unbounded crawls and memory-buffering large satellite data files.
- Parse HTML with source-specific adapters and schema checks rather than fragile one-off selectors. Parse RSS/XML, JSON API responses, PDFs, and explicitly supported office formats with dedicated parsers. Preserve original files and extraction metadata where licensing and storage policy allow. Keep parse errors and partial extractions visible.
- **Put a text-quality gate before chunking and embeddings.** Score extraction page by page and reject/quarantine pages with replacement characters, control-character noise, broken glyph mappings, mostly symbol-like output, implausible language/script mixtures, repeated boilerplate, or too little meaningful text. Use several signals together; don’t reject legitimate tables, formulas, IDs, or short catalog records based on a single alphanumeric-ratio threshold.
- **Route bad pages by cause.** First try a second text extractor for PDFs whose text layer looks corrupted. Use OCR only for pages that are image-based or still have no usable text, with language selection, page limits, and a separate OCR quality check. Don’t OCR every PDF by default. Keep the original page and extraction method/version for inspection.
- **Never embed unapproved extraction output.** Only chunks that pass quality checks enter the embedding queue. Put failures in a quarantine area with source, page, extracted sample, quality flags, and suggested recovery path. Provide a review/export command so a human can inspect representative failures without rerunning the whole crawl.
- Parse each supported format and reject unsupported/oversized files with an explicit status. Add bounded concurrency and batching for extraction and embedding, checkpoint progress, and support restart from the last completed page/chunk. Report pages seen, usable pages, rejected pages, OCR pages, duplicate pages, chunks indexed, embedding duration, and estimated/actual token or provider usage before and after each job.
- Build a regression corpus from the PDFs that previously produced unreadable text, including both bad and known-good examples. Include multi-column layouts, tables, scanned pages, unusual fonts/encodings, and normal selectable-text PDFs. Compare extracted text and quality decisions before re-indexing a large collection.
- Chunk documents with metadata: stable source ID, URL/file, title, page/section, checksum, fetched time, and parser version.
- Use structure-aware parsing for scientific PDFs: preserve headings, page boundaries, tables, units, captions, and product/mission identifiers. Make chunking respect sections and tables instead of cutting every document at a fixed character count.
- Store both a retrieval-sized passage and its parent section/page so a short matching chunk can be expanded with nearby context at answer time.
- Add idempotent indexing: unchanged documents are skipped; changed documents replace prior chunks; deleted sources can be removed.
- Create/validate the vector index and embedding dimension as part of setup. Fail ingestion with actionable errors if they disagree.
- Provide a dry-run mode, progress summary, retry handling, and an ingestion report.
- For actual satellite granule downloads, use MOSDAC's documented Data Download API adapter with dataset ID, date range, count, bounding box, and granule ID filters. Keep credentials in secrets, make downloads opt-in and bounded, resume interrupted transfers, verify file sizes/checksums when available, and honor MOSDAC quotas. Store raw NetCDF/HDF/GeoTIFF assets separately; only extract structured metadata or scientifically meaningful summaries into the RAG index when that is part of an explicit use case.
- Keep crawl/export utilities separate from indexing so a PDF export is not mistaken for a knowledge-base build.

**Complete when:** running ingestion twice produces no duplicates, every indexed chunk is traceable to a source, no low-quality extraction reaches embeddings, all crawl/download work is resumable and bounded, and failures are visible in a report. The old problem PDFs must be represented in the regression corpus and must either pass with readable extraction or be explicitly quarantined. Validate each adapter against saved real-world response fixtures so MOSDAC page changes are detected before production ingestion silently degrades.

### Phase 4 — Rebuild retrieval and answer generation

**Current status:** The chat path uses dense retrieval plus optional BM25, with a 30-second bounded dense-result cache and exact-query embedding cache. Graph retrieval is removed because it previously added embedding/Neo4j calls without adding results to answer context. Existing graph data and guarded legacy graph scripts remain untouched. A provisional lexical run exists, but no independently reviewed MOSDAC retrieval/answer set or end-to-end quality/latency baseline exists; therefore, accuracy and speed improvements are not yet established.

Dense retrieval now over-fetches up to 40 Pinecone matches before provenance and extracted-text quality screening, while still returning at most eight readable passages to fusion/context packing. This is intended to reduce empty or thin context when noisy legacy chunks occupy early ranks; candidate count remains bounded. The larger fetch has not been benchmarked against the MOSDAC index, so confirm latency and readable-result yield before further tuning.

The generation request now sends behavioral rules as a Gemini system instruction, while current evidence, the original current question, and bounded conversation history remain separate user/assistant content. The rules explicitly mark both history and retrieved passages as untrusted and require current-turn evidence for factual claims. The selected answer language is requested in the same grounded generation call (English, Hindi, Hinglish, Spanish, French, or German); both serial input and output translation nodes have been removed. This keeps the original wording and eliminates their latency and citation-rewrite risks. The active `nomic-embed-text` query model is tagged English on its model card; direct Hindi/Hinglish retrieval against the English-heavy index is therefore unvalidated and may be weaker. The user has asked to defer new document embeddings, so do not claim multilingual retrieval accuracy until a compatible retrieval strategy is evaluated. Prompt-injection, answer-language, and multilingual retrieval quality still need a reviewed set.

Retrieval source failures now remain distinguishable from successful searches with zero matches: one working retriever can serve a degraded answer, while failure of every configured source becomes a request error. Pinecone dimension mismatch still fails explicitly. This behavior needs provider failure-injection coverage before release.

When retrieval yields no citations and no user image is present, generation is skipped and a deterministic abstention is returned in the selected answer language. If retrieved sources exist but the answer cites none or cites an unavailable source ID, a localized grounding fallback replaces it and candidate sources are removed. When an answer includes valid citations plus uncited prose or list items, the uncited units are pruned and only citations used by the retained answer are returned; if nothing cited remains, the localized fallback is used. This avoids discarding an otherwise useful answer because of an uncited preamble while keeping uncited factual units out of the response. Citation presence does not prove semantic claim-to-source entailment, which still requires evaluation.

Citation presence validation also checks each Markdown list item independently and no longer skips an entire paragraph merely because it begins with a heading. This closes formatting-based citation bypasses; it still validates marker presence rather than semantic entailment.

- **Build a measurable baseline first.** Record retrieval and answer quality plus p50/p95 latency on a hand-checked MOSDAC query set before tuning. Compare each change against the same set so quality gains and latency costs are visible.
- **Improve the corpus before adding agent complexity.** Normalize spelling and aliases for missions, spacecraft, instruments, products, acronyms, and IDs. Preserve tables and units. Apply metadata filters for product, mission, sensor, date, and source type when the question makes them clear.
- **Use hybrid first-stage retrieval.** Run dense semantic retrieval and lexical/BM25 or sparse retrieval in parallel, then fuse ranked lists (for example with RRF) and deduplicate by stable chunk ID. This covers both paraphrased questions and exact terms such as product codes, instrument names, and mission identifiers.
- **Retrieve broad, then narrow.** Fetch a bounded candidate set from each retriever, optionally expand the best chunk to its parent section, then rerank the combined candidates with a dedicated cross-encoder or managed reranker. Pass only a small, high-value set of passages to the answer model. Benchmark the reranker’s quality gain against its latency and cost; allow a fast path to skip it for simple/high-confidence questions.
- **Make query expansion conditional.** Start with one query. Use a low-cost rewrite or a small number of parallel variants only when the question is ambiguous, conversational, multi-part, or the first retrieval is weak. Keep HyDE, multi-query fusion, and decomposition behind measurable routing rules; avoid multiple serial LLM calls on every turn.
- **Use conversation context carefully.** Rewrite follow-up questions into standalone retrieval queries using only the relevant recent turns. Keep the original user wording for answer generation and trace logs. Do not send the entire conversation to every retrieval or generation call.
- **Use adaptive retrieval and calibrated abstention.** Measure retrieval confidence using ranker signals and known relevance behavior rather than relying on an uncalibrated similarity-score cutoff. If evidence is weak, try one bounded fallback retrieval step; if it remains weak, ask a clarifying question or say the indexed sources do not support an answer.
- **Ground every answer.** Keep citations attached to each retrieved passage and require factual claims to point to one or more cited sources. Return source title, page/section, and link/file reference to the UI. Do not generate citations from model-invented URLs.
- **Keep graph retrieval out until it proves value.** If later evaluation supports graph retrieval for structured entity/relation questions, combine traceable graph results with text evidence only under a validated routing rule. Don’t call Neo4j for every question or keep a graph index without an evaluated use case.
- **Optimize the critical path.** Parallelize independent search calls; batch embedding work during ingestion; reuse initialized clients; cache normalized query embeddings and short-lived retrieval results with corpus/index version in the key; set provider timeouts and cancellation; cap candidates, context tokens, and model calls. Stream the answer after sufficient evidence is assembled. Measure cache hit rate and end-to-end p50/p95 latency.
- **Keep runtime state isolated.** Treat each request as a fresh retrieval/answer turn. If checkpointing is retained, define reducers and turn boundaries so history and retrieval results cannot accumulate across requests.
- **Separate concerns and telemetry.** Keep routing, retrieval, reranking, context assembly, grounded generation, and speech as distinct steps. Do not add a serial translation chain; request the chosen answer language from the answer model. Log request IDs, per-stage timings, candidate counts, selected sources, abstentions, and failures without logging secrets or full user content by default.

**RAG evaluation and speed gate:** create representative questions for exact product lookups, paraphrases, multi-hop mission/product questions, follow-ups, multilingual requests, and unanswerable questions. Track Recall@k, MRR or nDCG for retrieval; citation correctness, answer correctness, faithfulness, and abstention quality for answers; and p50/p95 latency and cost per answer. Use automated scoring to find regressions, but manually review a fixed gold set before accepting changes. Set numeric release thresholds after measuring the baseline rather than promising a speedup without a benchmark.

**Complete when:** a set of representative MOSDAC questions returns grounded answers with citations, and unsupported questions say so instead of fabricating details.

### Phase 4a — RAG optimization experiments

- Compare dense-only, lexical-only, and hybrid retrieval on the same gold queries.
- Compare fixed chunking with structure-aware chunks and parent-section expansion.
- Compare no reranker, a cross-encoder/managed reranker, and any more advanced late-interaction approach only if corpus size and quality needs justify its operational complexity.
- Compare single-query retrieval with conditional rewrite, bounded multi-query fusion, and HyDE; include their added model latency/cost.
- Tune candidate counts, final context size, and retrieval thresholds against both answer quality and p95 latency.
- Ship only improvements that beat the baseline on agreed quality metrics while meeting the agreed latency/cost budget; keep a simpler fallback configuration.

**Complete when:** each enabled retrieval technique has an evaluation result showing what it improves, its latency/cost impact, and why it belongs in the default path.

### Phase 5 — Rebuild the chat frontend

**Current status:** Chat send failures now preserve the user's text/image draft and remove the unsaved optimistic message so it can be retried without duplicating the conversation. Saved source footers are restored as structured citations in chat history. The conversation is now a focused live log for screen-reader announcements, and the message/voice controls have accessible labels; the broader accessibility and session-flow review remains outstanding. The production UI build and type-check pass with Next.js 16 using webpack. Answer language is requested directly in the grounded generation call; no translation node remains. Speech recognition is still browser Web Speech API fixed to `en-US`, not a Hindi/Hinglish Whisper service. A Hugging Face ASR candidate review is recorded in `workdone.md`; integration and transcription-quality validation remain outstanding.

- Use the shared API contract and a configurable API base URL; remove the hardcoded localhost address.
- Implement loading, retry, empty, error, and session-restoration states.
- Ensure text, image, history, and assistant citation data round-trip correctly. Resize/validate images and support image-only prompts if they are in scope.
- Make language choices honest: answer directly in the selected language, and support speech input only when the actual ASR locale/model is configured and quality checked. Do not show options that silently fall back to English. Hindi/Hinglish ASR still needs a real audio upload/runtime path; current browser recognition is fixed to `en-US`.
- Keep the chat UI responsive and accessible; remove mock sidebars and actions that imply live data.
- Add functional conversation actions such as new chat and copy answer only when their behavior is complete.

**Complete when:** a user can start a chat, refresh, restore history, ask a question, view citations, and recover from an API failure without losing the current conversation.

### Phase 6 — Decide and implement optional product features

**Current status:** Data Explorer and Map are deferred for the focused chat release. Their routes now explain that the features are unavailable and link users back to chat; the previous hard-coded dataset cards, download/preview controls, and placeholder map controls have been removed. The remaining optional-feature inventory (knowledge graph, voice, and unused sidebar/mock UI) is not yet fully resolved.

- **Knowledge graph:** add it only with an explicit schema, graph ingestion, vector/index creation, query tests, and evidence it improves user questions.
- **Data Explorer:** connect it to an actual catalog/API and implement search, filters, preview, and download; otherwise leave it out.
- **Map:** define data layers and a real geospatial source before choosing a map library; remove inert controls until then.
- **Voice:** use a deliberate speech-to-text and text-to-speech provider path with supported locale mapping, cancellation semantics, permissions/error handling, and size limits. Treat browser speech recognition as optional enhancement, not guaranteed functionality.

**Complete when:** every visible control performs its advertised action against real data, or is removed from the shipped interface.

### Phase 7 — Reliability, security, and release readiness

- Restrict CORS to configured frontend origins; add request validation, rate limits, payload limits, timeouts, and a health/readiness endpoint.
- Add authentication if conversations need user privacy or cross-device persistence. Ensure session IDs alone do not expose other users’ history.
- Add automated coverage for API contracts, session persistence, ingestion idempotency, retrieval/citation behavior, and core UI flows.
- Add a small evaluation set of MOSDAC questions with expected source documents and checks for citation correctness and unsupported-answer behavior.
- Add operational docs for backups, index rebuilding, model/provider configuration, logs, and failure recovery.
- Run dependency/security review and validate current framework/provider support immediately before release.

**Complete when:** a release candidate passes build, type checks, automated checks, retrieval evaluation, and a documented clean-environment deployment walkthrough.

## Recommended implementation order

1. Phase 0 scope and data inventory.
2. Phase 1 foundation and configuration.
3. Phase 2 API and persistence contract.
4. Phase 3 ingestion, then Phase 4 retrieval against the newly indexed data.
5. Phase 5 frontend against the stable API.
6. Phase 4a RAG experiments, then Phase 7 release checks for the focused chat product.
7. Phase 6 optional features only after the core release works.

This order avoids rebuilding the UI around unstable endpoints and avoids preserving a graph/vector setup that may not be useful.

## Current code disposition

| Current area | Planned disposition |
| --- | --- |
| `Backend/src/Controllers`, `Routes` | Replace with validated API modules and shared response contracts. |
| `Backend/src/Services/LangGraphChain.ts` | Rebuild as bounded orchestration; retain LangGraph only if stateful branching/checkpointing is justified. |
| `Backend/src/Services/Retrival.ts` | Replace with one tested retrieval module; retain RRF/HyDE only if evaluation supports them. |
| `Backend/src/Services/Memory.ts` and Mongo history | Replace with a single explicit history model and bounded context assembly. |
| `Backend/src/data_saver.ts`, `kg_saver.ts` | Replace with repeatable ingestion/indexing jobs. |
| `Backend/src/utils/Crawl/*` | Keep useful parsing pieces after fixing limits, format coverage, domain rules, retries, and reporting. |
| `Backend/src/Services/neo4jQueryGenrator.ts` | Archive or delete unless graph support is approved in Phase 0. It currently appears disconnected and contains an unrelated generic Cypher prompt. |
| `Frontend/components/chat-interface.tsx` | Rebuild around the typed API and verified flows; preserve useful visual styling selectively. |
| `Frontend/app/data`, `app/map`, sidebars, mock API | Remove from first release or implement only after real data contracts exist. |
| Generated `components/ui/*` | Keep only components used by the rebuilt interface. |

## Lessons to apply from the cloned reference projects

The repositories under `references/` are useful code studies, not validated production baselines. The decisions below come from tracing their fetch, extraction, indexing, and retrieval paths. Use the useful patterns while retaining the limits and failure cases in the implementation requirements.

### Crawler and MOSDAC source acquisition

- **Keep a reviewed seed list and make discovery bounded.** AstraQ's `static_pipeline/crawlers/crawl_static.py` starts with a curated `url_list.txt` and writes per-page JSON/HTML plus a crawl summary. Keep the explicit seed list and per-source crawl report. Add the missing durable queue, canonical URL identity, page/depth/byte budgets, and restart checkpoints. For MOSDAC, enrich the seeds from official catalog pages and RSS; do not turn a successful seed crawl into an unrestricted site crawl.
- **Use one fetched response to extract both content and links.** SatSage's `data_collection/crawler.py` fetches a page in `process_url` and then fetches it again in `get_links`. Avoid this duplicate network and parse work: the fetch job should return a response object whose body is parsed once for page content and outbound links. Use a deque or persistent queue; SagarMegh's `server/app/scraping/crawler.py` uses `list.pop(0)`, which becomes increasingly costly as the frontier grows.
- **Enforce exact host policy and canonicalize intentionally.** SagarMegh checks whether the base domain is a substring of `parsed.netloc`, which can admit lookalike hosts. Require an exact normalized hostname allowlist and re-check every redirect. Normalize scheme/host/default ports and fragments; retain query parameters that select a real catalog record, and strip only known tracking parameters from the deduplication key. Store both requested and final URL.
- **Make HTTP the default and browser rendering an exception.** AstraQ's `mosdac-scraper/scripts/mosdac_full_extractor.py` launches Playwright for pages, waits for `networkidle`, sleeps again, extracts broad body text, then follows internal links without a durable frontier or strict total cap. Use bounded HTTP fetches for static pages; configure a small allowlist of known JS-dependent pages for browser rendering. Set per-page timeout, total job deadline, page and byte caps; persist the queue and visited state. Do not use sleeps as a substitute for readiness or rate control.
- **Add explicit fetch safety and operational behavior.** AstraQ's downloader streams files but writes directly to a basename and skips existing paths; its static crawler retries but has no content caps, robust identity, or response validation. Add status/content-type/signature validation, exact-host redirect checks, size limits, retries with jitter and `Retry-After`, checksum and metadata recording, and temp-file-then-atomic-rename. Write to collision-safe paths derived from stable source IDs. Never treat an HTML error page saved as `.pdf` as a document.
- **Extract the main content without trusting one CSS selector forever.** AskMOS's `backend/data/web-scraper.py` focuses on `div#content`, reducing navigation noise, but its single selector is brittle and its saved filename can collide after truncation. Use per-source selectors as hints, then validate extracted title/text/links and fall back to a general parser. Remove scripts, styles, navigation, footer, and repeated chrome; retain headings, tables, captions, link labels, and relevant image alt text. Store stable URL IDs rather than URL-derived filenames. Keep saved HTML fixtures so selector changes can be detected.
- **Separate three different MOSDAC jobs.** Crawl public documentation and catalog metadata for RAG; poll official RSS/catalog feeds for change discovery; download satellite granules only through the documented authenticated MOSDAC API under an explicit user-triggered job. SagarMegh's `MosdacClient` is a useful indication of catalog/token/download operations, but its endpoint assumptions, missing timeouts/retry/quota/checksum handling must be verified against current official documentation before any implementation. Do not copy undocumented endpoints or mix large NetCDF/HDF/GeoTIFF granules into the text corpus by default.

### PDF extraction and protection against unusable text

- **Keep SatSage's separation of stages, but avoid its repeated extraction and heuristic shortcuts.** `SatSage/data_collection/document_processing.py` tries standard PDF extraction and later runs another scientific extraction pass; its Hindi heuristic OCRs the whole PDF at 600 DPI and its global Roman-to-Devanagari substitutions can corrupt ordinary English. Parse each page once with the primary extractor, preserve page numbers/layout/table output, and invoke a secondary extractor only for pages that fail quality checks. OCR only image-only or still-unusable pages, at bounded DPI and page/time limits, with language configured from document/page evidence. Do not globally replace characters to “repair” garbled text.
- **Make quality decisions page-level and inspectable.** Neither SatSage's normalizer nor AstraQ's `clean_text` meaningfully detects gibberish; simple whitespace cleanup and dropping numeric lines cannot identify broken font maps. Score replacement/control characters, suspicious symbol runs, word-like token ratio, repeated text, language/script plausibility, and text density together. Add document-aware exceptions for formulas, product IDs, tables, and short catalog entries. Record score, signals, parser/OCR method, and a short sample; quarantine low-confidence pages before chunking/embedding.
- **Preserve useful structure through normalization.** SatSage's normalizer handles Unicode normalization, ligatures, and whitespace, but its broad character mapping is unsafe. SagarMegh's `preprocess.py` collapses content into whitespace-normalized 500-word chunks, losing table and section structure. Normalize Unicode/whitespace conservatively while preserving headings, page breaks, table rows/cells, units, captions, and identifiers. Chunk by structure and token budget, with page/section lineage.
- **Use cost gates before embedding.** AstraQ's `parse_pdfs.py` extracts each page with pdfplumber but does not screen quality before writing parser output; AskMOS embeds static text chunks with no visible extraction gate. Make the ingestion report show discovered/downloaded/parsed/accepted/quarantined pages, estimated chunk/token/embedding volume and projected provider cost. A dry run must be able to inspect representative output and enforce `--max-pages`, `--max-documents`, and byte limits before embeddings are enabled. Reprocess from saved raw files after parser changes rather than crawling again.

### Retrieval and answer generation

- **Do not mistake multiple retrieval sources for a well-implemented hybrid retriever.** AstraQ's `rag_pipeline/retrieve.py` combines vector results and keyword/graph paths and uses a hand-built keyword score for reranking; its fallback scans the FAISS docstore. SagarMegh uses Qdrant vector search, while AskMOS uses Chroma similarity search over 500-character chunks. Use the planned dense plus lexical/BM25 (or sparse) first stage with rank fusion, bounded candidate counts, metadata filters, and an optional measured cross-encoder. Avoid full-index fallback scans on the request path.
- **Retrieve once and keep evidence consistent.** AstraQ retrieves candidates for source selection and then `rag_qa` performs another retrieval, potentially with a different query; its answer sources can therefore diverge from the context used to generate the answer. Make one retrieval result object the input to reranking, context assembly, answer generation, and citation rendering. Cite exact chunk/page/section identifiers from those passages and expose the evidence actually sent to the model.
- **Avoid unconditional hypothetical generation.** SagarMegh's `ai_chatbot.py` generates a detailed hypothetical answer on every turn and uses it as the only search query before generating the real answer. This costs an extra model call and risks steering search toward invented details. Start with the user's query; use bounded aliases or a rewrite only when intent is ambiguous or first-pass evidence is weak. Gate HyDE, multi-query, and decomposition behind evaluation and latency/cost measurements.
- **Keep deterministic routing for catalog facts, with evidence fallback.** AstraQ's intent router and acronym expansion show useful low-cost patterns, and MOSDAC product identifiers often benefit from exact structured lookup. Route only well-defined catalog questions to a parsed catalog index/API and return source-backed fields. If parsing/API lookup has no confident match, use document retrieval or ask a clarifying question; never synthesize missing catalog fields.
- **Treat cache correctness as part of retrieval correctness.** AstraQ's `backend/answer_cache.py` is an in-memory TTL cache keyed by question/mode, so it is process-local and does not inherently invalidate when the corpus changes. Any rewrite cache must include normalized query, filters/language, model/prompt settings, and corpus/index version; cache retrieval separately from generated answers where possible.

### Evaluation lessons

- **Upgrade the reference projects' smoke checks into evidence checks.** AstraQ's `eval_suite` checks expected keywords, response length, and forbidden strings; this can catch obvious failures but cannot establish that a cited page supports an answer. SagarMegh's examples demonstrate end-to-end calls but do not substitute for a judged retrieval set. Build a fixed MOSDAC question set with expected document and page/chunk, exact-ID lookups, paraphrases, table questions, multilingual queries, follow-ups, and unanswerable cases. Score Recall@k/MRR or nDCG, answer correctness, citation entailment/support, abstention, latency, and cost.
- **Turn reference defects into regression cases.** Include fixtures for duplicate-fetch avoidance, lookalike host rejection, query-sensitive URL identity, browser-render budget enforcement, repeated page chrome, text-layer gibberish, image-only PDF OCR, mixed English/Hindi pages, tables, and retryable/oversized downloads. Keep the previous bad PDFs as fixtures and assert that failed pages never enter embeddings.

Concrete code paths reviewed include `SatSage/data_collection/crawler.py`, `SatSage/data_collection/document_processing.py`, `SatSage/data_processing/processors/text_normalizer.py`, `SatSage/tests/eval_suite.py`, `isro-sagarmegh-ai/server/app/scraping/crawler.py`, `scraper.py`, `preprocess.py`, `services/ai_chatbot.py`, `Astra_Q_Backend/static_pipeline/crawlers/crawl_static.py`, `download_docs.py`, `parsers/parse_pdfs.py`, `rag_pipeline/retrieve.py`, `backend/answer_cache.py`, `mosdac-scraper/scripts/mosdac_full_extractor.py`, and `AskMOS/backend/data/web-scraper.py` / `backend/RAG/semantic_rag/retriever_engine.py`. The cloned source remains under `references/` for line-by-line follow-up.

**Reference repositories reviewed:** [SatSage](https://github.com/rupeshbharambe24/SatSage), [ISRO SagarMegh AI](https://github.com/Ravi0529/isro-sagarmegh-ai), [AstraQ Backend](https://github.com/Gowri-Arun/Astra_Q_Backend), and [AskMOS](https://github.com/quacky20/AskMOS). Their cloned source is under `references/` for local comparison.

## Risks and decisions to resolve early

- **Existing data:** establish whether Pinecone/Neo4j contain valuable indexed data before replacing indexes or schemas.
- **Graph requirement:** keeping Neo4j adds ingestion, schema, indexing, and operations work; validate real graph-shaped user questions first.
- **Provider choice:** confirm which generation, embedding, speech recognition, and speech synthesis providers are affordable and available for the target deployment.
- **Scope creep:** maps, live satellite layers, and data downloads are separate products from a document-grounded assistant; keep them out of the first release unless prioritized explicitly.
- **No data quality without evaluation:** ingestion success alone does not show that retrieved passages answer user questions; build the question/source evaluation set early.
- **No assumed speedup:** hybrid search, reranking, and query rewriting can improve relevance while adding latency. Measure each stage and retain expensive steps only when they improve answer quality enough to justify their cost.

## RAG references

These are starting points for the design review, not a mandate to adopt a vendor or a technique without benchmarking:

- [Pinecone semantic search and metadata filtering overview](https://www.pinecone.io/learn/search-with-pinecone/)
- [Pinecone cascading retrieval: dense, sparse, and reranking](https://www.pinecone.io/blog/cascading-retrieval/)
- [RAG-Fusion and reciprocal-rank fusion](https://arxiv.org/abs/2402.03367)
- [ColBERTv2 late-interaction retrieval](https://arxiv.org/abs/2112.01488)
- [RAGAS evaluation dimensions for retrieval and generation](https://arxiv.org/abs/2309.15217)

## MOSDAC source references

- [MOSDAC Data Download API manual](https://mosdac.gov.in/downloadapi-manual) — documented catalog search and authenticated download workflow, including dataset ID and query filters.
- [MOSDAC satellite catalog](https://www.mosdac.gov.in/catalog/satellite?language=en) and [radar catalog](https://www.mosdac.gov.in/catalog/radar.php) — public product catalog sources.
- [MOSDAC RSS feeds](https://mosdac.gov.in/rss-feed) — official feed list for selected near-real-time product updates.
