# AstroLynx

AstroLynx is being rewritten as a MOSDAC assistant with a focus on trustworthy document retrieval, useful citations, and a bounded ingestion pipeline. The repository currently contains the original Next.js frontend and a legacy Express API while the new ingestion foundation is built alongside them.

## Project status

- New-device setup and local run instructions are in [`RUN.md`](./RUN.md).
- The original UI lives in `astrolynx-chatbot Frontend/`.
- The original API lives in `Backend/`.
- The rewrite plan is [`REWRITE_PLAN.md`](./REWRITE_PLAN.md).
- The current RAG request path, offline ingestion boundaries, and Mermaid workflows are documented in [`architecture.md`](./architecture.md).
- The running handoff/progress log is [`workdone.md`](./workdone.md). Read it before continuing implementation; it records decisions, data inventory, validations, and next steps.
- The local PDF inventory is [`docs/corpus_inventory.json`](./docs/corpus_inventory.json). It contains paths, file sizes, PDF signature results, and SHA-256 hashes; no source PDFs were changed.
- Cloned projects under `references/` are read-only study material and are not used as application dependencies.

The chat service still uses the legacy MongoDB, Gemini, Pinecone, and Ollama RAG stack; Neo4j is not part of chat retrieval. The UI now requires an account and uses MongoDB-backed revocable login cookies. Conversations are scoped to account owners; older anonymous sessions are not automatically claimed by an account. Each new conversation gets a question-derived title and is refined in the background with the smaller `GEMINI_TITLE_MODEL` (default `gemini-3.5-flash-lite`). The API starts without connecting providers; `/healthz` is a liveness check. The first chat request still needs MongoDB, Gemini, Pinecone, and Ollama. New messages are written one document per message to `MONGO_MESSAGES_COLLECTION_NAME` (default `astrolynx_chat_messages_v2`) with a session/time index; reads combine these with the legacy session document. Prompt history reads at most 200 recent messages and the history endpoint returns at most 100. This avoids growing the legacy single-session document beyond MongoDB's per-document size ceiling without bulk migration or deletion, though collection-level retention/backups remain operational work. Graph execution no longer persists duplicate turn checkpoints; existing checkpoint collection data is untouched. Do not use the legacy `crawl-full`, `data_saver`, or `kg_saver` jobs to build a new index; their extraction quality and idempotency gates are not adequate.

## Runtime and package manager

- Node.js 24 LTS (version line pinned in `.nvmrc` and `package.json`).
- pnpm 11.5.3 (pinned in the root `package.json`).

Install the pinned package manager, then install from the repository root:

```bash
npm install --global pnpm@11.5.3
pnpm install
```

The workspace explicitly allows install scripts for `sharp` and `protobufjs`. Those are the only dependencies currently approved to run lifecycle scripts; this setting was made after inspecting their install scripts.

## Development commands

Run commands from the repository root:

```bash
pnpm dev:web
pnpm dev:api
pnpm typecheck:web
pnpm typecheck:api
pnpm lint
pnpm build
```

The Next.js production build runs ESLint and TypeScript checks; lint is no longer suppressed. `pnpm lint` runs the frontend lint rules directly.

The web app runs at `http://localhost:3000`; the API defaults to port `5001` and reports liveness at `http://localhost:5001/healthz`. Port 5000 is commonly occupied by macOS ControlCenter, so use `PORT` to select another available port if needed. The API handles `SIGINT`/`SIGTERM` by draining HTTP requests, closing lazy MongoDB/Neo4j connections, and exiting after a 10-second shutdown deadline if draining hangs. Chat is limited to 20 requests per minute per IP, session endpoints to 120, and authentication endpoints to 20 per 15 minutes; configure `CHAT_RATE_LIMIT_MAX`, `SESSION_RATE_LIMIT_MAX`, and `API_RATE_LIMIT_WINDOW_MS` in `Backend/.env`. The built-in limiter store is per process; use a shared store before scaling to multiple API instances. `TRUST_PROXY_HOPS` defaults to `0`; set it to the exact trusted proxy hop count when deployed behind a proxy so rate limits use the client address without trusting arbitrary forwarded headers. Configure additional trusted browser origins with comma-separated `CORS_ORIGINS` in `Backend/.env`.

The frontend API origin defaults to `http://localhost:5001`; set `NEXT_PUBLIC_API_BASE_URL` in `astrolynx-chatbot Frontend/.env.local` to target another API deployment. See the frontend `.env.example` for the local value. Because this is a `NEXT_PUBLIC_` setting, it is included in the client bundle at build time and must not contain secrets.

Create the backend environment file with:

```bash
cp Backend/.env.example Backend/.env
```

The current chat path needs valid MongoDB, Gemini, Pinecone, and Ollama services/credentials. New authentication and title generation use the existing MongoDB and Gemini credentials; no separate auth provider or key is required. `GEMINI_TITLE_MODEL` defaults to `gemini-3.5-flash-lite` and can be changed independently. Neo4j is not part of chat retrieval: the legacy branch did not feed graph results into the answer context, so it was removed from the request path. Existing Neo4j databases and legacy ingestion tools are untouched. Generation settings are validated: `GEMINI_TEMPERATURE` defaults to `0.2` (range `0`–`2`) and `GEMINI_MAX_OUTPUT_TOKENS` defaults to `2048` (range `128`–`8192`). These defaults bound randomness and output size for the factual assistant, but have not been tuned against a judged answer set. See `Backend/.env.example` and `Backend/src/config/env.ts`. Never commit `Backend/.env` or real secrets.

The current legacy request path has been trimmed to one original-query vector search by default. It no longer calls an LLM to create hypothetical answers or 3–5 query rewrites on every turn. Startup checks that the configured Pinecone index exists and is dense. When Pinecone reports an integrated embedding model, startup rejects a reported model that differs from `nomic-embed-text`; on the first query, the actual Ollama vector length is checked against the index dimension. If Pinecone omits embedding-model metadata, startup warns that only dimension can be checked, so the historical document-vector model still needs independent confirmation. Up to 40 Pinecone candidates are screened for readable text and source provenance, then at most 8 are retained; the larger candidate pool is bounded but has not been benchmarked on the production index. If all configured retrievers fail, chat returns an API error rather than presenting infrastructure failure as an ordinary no-evidence answer; if one retriever works while another fails, the working retriever can still answer and the degraded state is logged. Neo4j retrieval was removed from chat because its results were not included in answer context. Query embeddings are cached by exact query hash for five minutes (up to 128 vectors per API process); this can avoid repeat Ollama calls, but its hit rate and latency benefit have not been measured. Optional hybrid BM25 retrieval and an offline source/page evaluation harness are implemented; its tokenizer retains Unicode combining marks so Hindi words are not split at vowel signs. This supports exact lexical matching only when the query and indexed text share words; it does not make the active English-focused dense embedding model multilingual. A human-labeled MOSDAC set, retrieval comparison, and measured quality/latency results are still outstanding.

Repeated exact dense queries also reuse their screened Pinecone results for up to 30 seconds (up to 64 cached queries per API process; entries larger than 100,000 passage characters are not cached). This can avoid both the Ollama embedding and Pinecone search for repeats; cache hit, coalescing, and duration are logged without query text. The short TTL limits staleness after index updates. Actual workload-level latency benefit remains to be measured.

The legacy `data_saver.ts` and `kg_saver.ts` modules no longer start work when imported. `kg_saver.ts` additionally refuses direct execution unless `--execute` is explicitly supplied; that opt-in does not make its extraction/indexing path quality-approved. Do not run it against existing Neo4j data as part of this rewrite. The old `data_saver.ts` currently has vector writes disabled and is not an approved ingestion route.

Answers now receive source blocks labeled `[S1]`, `[S2]`, and so on. The model is instructed to cite those IDs, unsupported answers are converted to a citation-aware abstention, source metadata is returned to the chat UI, and a source footer is saved with chat history. English, Hindi, Hinglish, Spanish, French, and German are requested directly in the grounded generation call; no input/output translation model call is used. This avoids serial translation latency and prevents a second model from rewriting citations. The current `nomic-embed-text` query model is English-focused, so direct Hindi/Hinglish queries may retrieve English passages less reliably. We are retaining the current embedding/index and do not claim reliable multilingual retrieval until it is evaluated; switching to a multilingual embedding space would require re-embedding the indexed documents. These behaviors also remain dependent on the legacy vector index having accurate `source` and page/title metadata; do not treat missing or generic provenance as a valid citation.
When retrieval returns no citable passages and the user did not provide an image, the API now skips Gemini answer generation and returns a fixed abstention in the selected response language. This avoids spending a generation call on a no-evidence turn and does not ask the model to invent an answer. If sources exist but the generated answer has no valid current-turn citation, the answer is replaced with a localized grounding fallback and those unverified sources are omitted from the response/footer.

## Inspect a PDF without embedding it

The current safe inspection command reads one PDF, extracts a bounded number of pages, scores extraction quality, and prints a JSON report. It does not write corpus files or call an embedding provider:

```bash
pnpm ingest:inspect-pdf -- --pdf "downloaded_docs/10-1752058902635.pdf" --max-pages 40 --max-bytes 52428800
```

The default limits are 500 pages and 50 MiB. Quality scores are provisional heuristics; pages marked `review` or `reject` must not be embedded automatically. Check `workdone.md` for the current evaluation status before using the report to make corpus-wide decisions.

Inspect a bounded sample across the local PDF folders with aggregate and per-file outcomes:

```bash
pnpm ingest:inspect-corpus -- --max-documents 100 --max-pages-per-pdf 8
pnpm ingest:inspect-corpus -- --max-pages-per-pdf 8 --output ../docs/pdf_quality_review.json
pnpm ingest:inspect-corpus -- --max-documents 10 --max-pages-per-pdf 8 --include-page-text-samples --output /tmp/pdf_review_bundle.json
pnpm ingest:inspect-corpus -- --sample-page-positions --include-page-text-samples --output /tmp/pdf_position_sample.json
```

By default this scans `Backend/downloaded_docs/` and `Backend/mosac-data/`. It reads only, samples the first pages of each file, and does not index; output reports are created exclusively and are never overwritten. `--include-page-text-samples` adds at most 1,000 characters per sampled page with its provisional score and quality signals, for human labeling. Such reports contain source text and should be stored/handled accordingly.

Create a bounded chunk-plan report before considering any indexing:

```bash
pnpm ingest:plan-pdf-chunks -- --max-documents 5 --max-pages-per-pdf 8 --output /tmp/mosdac_chunk_plan.json
```

The planner includes text only from pages currently scored `usable`, keeps chunks within each page, reports stable document/chunk hashes and estimated token volume, and never embeds or writes to a vector store. Defaults are five PDFs, eight pages per PDF, 2,000 pages total, 1 GiB total input bytes, 200,000 estimated tokens total, 3,500 characters per chunk, and 350 characters of overlap. Override aggregate limits with `--max-total-pages`, `--max-total-bytes`, and `--max-total-tokens`; PDFs that exceed the remaining aggregate byte budget are listed as skipped, parsing stops when the page budget is consumed, and whole pages are skipped when their planned chunks would exceed the remaining token budget. The token estimate is still a planning estimate (`ceil(characters / 4)`), not provider tokenizer accounting. The quality gate is provisional; a `usable` score is not approval for a bulk index until representative pages are labeled and thresholds calibrated. Relative `--input-dir` arguments resolve from `Backend/` because the command runs inside that package. Reports contain extracted chunk text, so review/store them like source text and use exclusive new output paths.

The chunk planner uses full-file SHA-256 content identity and plans exact duplicate PDFs only once; later file paths remain in the report as `duplicate_pdf_content` skips. It preserves all original PDF files. Duplicate copies are read and hashed within the byte budget, then skipped before page parsing. This avoids emitting repeated chunk IDs that the lexical sidecar builder would reject. PDF metadata titles are sanitized and carried into chunks and retrieval citations, with the filename stem used when metadata has no usable title. A full bounded run against the current 56-file corpus skipped seven duplicate copies and produced 346 unique chunks, but remains provisional and is not a production-ready corpus.

Each normal document summary lists `acceptedPageNumbers`. The lexical sidecar builder requires the current quality-policy version, recomputes every stable chunk ID from source hash/page/chunk/text, and rejects chunks whose page is not listed as accepted for that source.

An optional BM25 sidecar can be built from a reviewed chunk-plan report:

```bash
pnpm ingest:build-lexical -- --plan /path/to/reviewed_chunk_plan.json --output /path/to/new_mosdac_bm25.json
```

This writes no embeddings or vector index. Set `MOSDAC_LEXICAL_INDEX_PATH` in `Backend/.env` to the sidecar path to enable BM25 retrieval alongside Pinecone; dense and lexical ranks are combined with reciprocal-rank fusion. Leave it unset for dense-only mode. The sidecar is loaded lazily on the first query, capped at 128 MiB, 50,000 chunks, 20 million tokens, and 5 million document-term postings, then held in process memory; restart the API to load a replacement sidecar at the same path. Search uses compact postings so each query scores only chunks containing its terms. Use only calibrated, reviewed chunk plans: the sample index built during development is a one-document wiring check, not a usable production corpus or evidence of retrieval quality/speed.

An offline evaluator is available for a human-labeled BM25 source/page set. Its dataset format, label guidance, metrics, and command are in [`docs/evaluation/README.md`](./docs/evaluation/README.md). It scores retrieval only; it does not establish answer correctness or hybrid/dense quality.

## Crawl MOSDAC HTML/catalog pages (not satellite granules)

The crawler defaults to a dry run and makes no network requests unless `--execute` is present:

```bash
pnpm ingest:crawl-mosdac -- --max-requests 10 --max-depth 1
pnpm ingest:crawl-mosdac -- --execute --max-requests 10 --max-depth 1
pnpm ingest:crawl-mosdac -- --execute --render-js --max-requests 10 --max-depth 1 --max-render-pages 3
```

Execution checks `robots.txt` before requesting pages, stops if the policy cannot be verified, uses an exact hostname allowlist, follows only same-host redirects whose target path is also allowed by `robots.txt`, honors crawl delay and `Retry-After`, caps responses, and saves resumable state plus raw/extracted artifacts under `Backend/storage/mosdac-crawl/`. It never embeds. Keep page/depth limits low while reviewing results. `--retry-failed` retries persisted failures; `--refresh-seeds` re-fetches the configured seeds using ETag/Last-Modified validators when available.

Each HTML/feed record includes an extraction quality assessment and policy version. Pages with unresolved Angular template bindings are marked `needs_browser_render`; by default they remain static-shell records with incomplete catalog rows. Opt-in rendering is described below. The local 56-PDF first-eight-page sample is recorded in [`docs/pdf_sample_quality.json`](./docs/pdf_sample_quality.json); its thresholds remain provisional.

RSS/Atom entries are parsed as structured metadata and receive deterministic entry IDs. Preview images are kept as preview metadata, excluded from the crawl frontier, and are not treated as direct granule download URLs. Successful non-empty, complete XML snapshots are stored under `feeds/<feed-id>/` as per-entry JSON records plus a manifest. Updates are atomic by entry ID; entries missing from a later complete snapshot are marked inactive and retained. Per-feed writer locks serialize concurrent snapshots, and an output-directory crawl lock protects the shared resumable queue and state from concurrent crawler runs. If a process crashes and leaves `.writer.lock` or `.crawl.lock`, the next writer fails closed after 30 seconds; inspect the recorded PID/host and remove the lock only after confirming its owner is no longer writing. The live ISROCast feed was crawled under a one-request cap and persisted as 25 entries. Its items do not expose separate product URLs, so the crawler does not infer download links.

The default seed list includes the five RSS product feeds named on the [official MOSDAC RSS page](https://mosdac.gov.in/rss-feed), in addition to the RSS listing page and satellite/radar catalogs. XML URLs are also allowed as discovered links. This makes feed ingestion independent of the listing page's markup; each feed still goes through robots policy, host checks, and the request budget. The other four product feeds are seeded but still need individual live validation because the latest bounded request attempt could not reach MOSDAC from this environment.

JavaScript rendering is opt-in with `--render-js`, only runs for pages flagged by static extraction, and is capped at three pages by default (hard maximum ten). The renderer blocks non-HTTPS, cross-host, robots-disallowed, image, media, and font requests; same-host browser requests are serialized using the robots crawl delay, limited to 40 per rendered page, and capped at four in-flight requests. It enforces a 45-second render deadline, a 20 MiB aggregate encoded-response cancellation cap per rendered page (`--max-render-bytes`, hard maximum 100 MiB), and a final DOM size check. Chromium DevTools response-header and byte events trigger browser-context cancellation before the configured cap; the trigger reserves up to 128 KiB (or half of smaller caps) for in-flight responses. In a 250 KB live check, cancellation occurred at 150,237 bytes, below the configured cap; unknown-length in-flight responses can still overshoot, so this is not a strict network firewall byte guarantee. Browser requests are additional to the top-level `--max-requests` crawl budget. Install Playwright's browser with `pnpm --filter astrolynx-api exec playwright install chromium`, or set `MOSDAC_BROWSER_EXECUTABLE_PATH` to a local Chrome/Chromium binary.

## Data safety

- Preserve `Backend/downloaded_docs/` and `Backend/mosac-data/`; they are existing project data.
- Keep crawl/download, extraction, quality review, chunking, and embedding as separate resumable stages.
- Do not bulk re-embed the historical corpus until the quality gate is calibrated on labeled good and bad MOSDAC pages and the dry-run report has been reviewed.
- Satellite granule downloads are a separate authenticated MOSDAC API workflow; they are not part of the public documentation RAG index by default.
