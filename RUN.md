# Run AstroLynx on a new device

This guide starts the existing AstroLynx web app and API in local development. It assumes you have access to the repository and credentials for the services used by the current chat system. It does not create or re-embed a MOSDAC index.

## 1. What you need

- Git
- Node.js 24 (the repository pins this major version in `.nvmrc` and requires `>=24 <25`)
- pnpm 11.5.3
- An Ollama service with the `nomic-embed-text` model
- A MongoDB database/Atlas URI
- A Gemini API key
- A Pinecone API key and the existing populated dense index used by this project

The current chat flow needs MongoDB, Gemini, Pinecone, and Ollama. The browser app and API can start without connecting to those providers; authentication requires MongoDB, and the first chat request initializes the RAG providers.

The Pinecone index must be the project’s existing index with MOSDAC content and query vectors compatible with `nomic-embed-text` (768 dimensions in the current setup). An empty index or merely matching vector dimensions does not provide usable retrieval. Do not create a replacement index or re-embed the corpus as part of local setup.

## 2. Install Node.js 24 and pnpm

Using `nvm` on macOS/Linux:

```bash
nvm install 24
nvm use 24
npm install --global pnpm@11.5.3
```

Confirm the versions:

```bash
node --version
pnpm --version
```

Node should report version 24.x and pnpm should report 11.5.3. Other Node version managers can also use the repository’s `.nvmrc` value (`24`).

## 3. Clone and install the project

Replace `<repository-url>` with the Git URL for this project:

```bash
git clone <repository-url> AstroLynx
cd AstroLynx
pnpm install
```

Run `pnpm install` from the repository root. The root is a pnpm workspace containing `Backend/` and `astrolynx-chatbot Frontend/`.

## 4. Configure environment files

Create local environment files from the checked-in examples:

```bash
cp Backend/.env.example Backend/.env
cp "astrolynx-chatbot Frontend/.env.example" "astrolynx-chatbot Frontend/.env.local"
```

Edit `Backend/.env` and set these values:

```dotenv
GEMINI_API_KEY=your_gemini_api_key

MONGO_URI=your_mongodb_connection_uri
MONGO_DB_NAME=your_database_name
MONGO_COLLECTION_NAME=your_chat_sessions_collection

PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_existing_populated_index
```

Use the actual database, collection, and index names provided for your deployment. MongoDB can create the named collections on first use if they do not exist. If a MongoDB URI contains special characters in the username or password, URL-encode those credentials. Keep these secrets only in local `.env` files; never commit them or paste them into issue logs.

Leave the three `NEO4J_*` settings blank in `Backend/.env` unless you specifically need a legacy Neo4j tool. Neo4j is not part of the current chat retrieval path, and the environment validator requires all three Neo4j values if any one is set.

The frontend can use the local API default (`http://localhost:5001`). If you need a different API origin, set `NEXT_PUBLIC_API_BASE_URL` in `astrolynx-chatbot Frontend/.env.local`, for example:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:5001
```

The API’s default CORS origin is `http://localhost:3000`. If the web app uses another origin, add it to the comma-separated `CORS_ORIGINS` in `Backend/.env`.

### Required and optional settings

| Setting | Needed for | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Chat answers and generated chat titles | Required for chat generation. |
| `MONGO_URI`, `MONGO_DB_NAME`, `MONGO_COLLECTION_NAME` | Signup/login and chat history | All three are required together. Mongo collections and indexes are created lazily. |
| `PINECONE_API_KEY`, `PINECONE_INDEX_NAME` | MOSDAC retrieval | Must point to an existing compatible dense index containing the project’s documents. |
| Ollama at `OLLAMA_BASE_URL` | Query embeddings | Defaults to `http://localhost:11434`; the `nomic-embed-text` model must be available. |
| `MONGO_MESSAGES_COLLECTION_NAME` | New chat-message storage | Optional; defaults to `astrolynx_chat_messages_v2`. |
| `GEMINI_MODEL`, `GEMINI_TITLE_MODEL` | Main answer and title models | Optional; defaults are in `Backend/.env.example`. |
| `MOSDAC_LEXICAL_INDEX_PATH` | BM25 hybrid retrieval | Optional. Leave blank for dense-only retrieval. |
| `MOSDAC_BROWSER_EXECUTABLE_PATH` | JavaScript-rendered crawler pages | Only needed when running the opt-in crawler and using a local Chrome/Chromium binary. |
| `SARVAM_AI_API_KEY` | Optional speech provider | Not required for normal text chat. |
| `PINECONE_ENVIRONMENT` | Legacy compatibility | Unused by the current Pinecone client. |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | Legacy graph tools | Not required for chat; leave all three blank. |

## 5. Start Ollama and get the embedding model

Install Ollama for your operating system using its official installer. Then download the exact embedding model used by the API:

```bash
ollama pull nomic-embed-text
```

Make sure Ollama is running. The desktop app normally keeps the service available; if it is not running, start it in a separate terminal:

```bash
ollama serve
```

Check that the model is installed:

```bash
ollama list
```

The API calls Ollama at `OLLAMA_BASE_URL` (`http://localhost:11434` by default). Do not substitute a different embedding model without verifying/rebuilding the document index; query and document embeddings must be compatible.

## 6. Start the API and web app

Open two terminals at the repository root.

Terminal 1 — API:

```bash
pnpm dev:api
```

Expected startup message:

```text
AstroLynx API listening on port 5001
```

Terminal 2 — web app:

```bash
pnpm dev:web
```

Open [http://localhost:3000](http://localhost:3000). Create an account or sign in. The account and conversation data are stored in MongoDB.

To stop either process, press `Ctrl+C` in its terminal. The API handles `SIGINT` and `SIGTERM` and drains active requests before shutdown.

## 7. Check that services are reachable

Check API liveness:

```bash
curl http://localhost:5001/healthz
```

Expected response:

```json
{"status":"ok"}
```

This endpoint only confirms the API process is listening; it does not check MongoDB, Gemini, Pinecone, or Ollama. The first signup/login request connects to MongoDB. The first chat request initializes the RAG services and then checks the Pinecone index and Ollama query embedding.

Once signed in, ask a question about a fact in the indexed MOSDAC corpus. Watch the API terminal for retrieval and generation logs. A good first check is a simple, corpus-covered question such as “What is INSAT-3D used for?” The answer depends on the actual contents and quality of the Pinecone index.

## Common setup problems

- **Node engine warning:** switch to Node 24 with your Node version manager, then rerun `pnpm install` from the repository root.
- **Port 5001 is already in use:** set `PORT` in `Backend/.env` to another free port and update `NEXT_PUBLIC_API_BASE_URL` in the frontend `.env.local` to match. Restart both processes after changing environment files.
- **CORS error in the browser:** make sure the web origin is listed in `CORS_ORIGINS` (default `http://localhost:3000`) and that the frontend API URL points to the actual API port.
- **MongoDB authentication failure:** confirm the database user's credentials, database access/network allowlist, and percent-encode special characters in the URI username/password.
- **Gemini key/model failure:** confirm `GEMINI_API_KEY` is valid and that the configured model is enabled for the key/project. The backend logs a sanitized provider error when generation fails.
- **Pinecone index missing or dimension/model mismatch:** set the exact existing index name and API key. Confirm its document vectors were produced with an embedding model compatible with `nomic-embed-text`; do not fix a mismatch by changing only the query model.
- **Ollama connection/model error:** ensure Ollama is running at `OLLAMA_BASE_URL` and `ollama list` shows `nomic-embed-text`.
- **Login works but chat fails:** check the API terminal first. The liveness endpoint may return 200 even when a chat provider is unavailable.

## Useful project commands

Run from the repository root:

```bash
pnpm typecheck:api
pnpm typecheck:web
pnpm lint
pnpm build
```

These commands check/type-build the code. They do not populate Pinecone or download MOSDAC documents. Read `README.md`, `architecture.md`, and `workdone.md` for the current RAG design, ingestion safety rules, and project status before attempting data ingestion.

## Data and credential handoff checklist

For a new machine, arrange access to:

- The Git repository and any existing private corpus/index handoff files required by your team.
- MongoDB URI and the database/legacy collection names.
- Gemini API key.
- Pinecone API key and the correct existing index name.
- Ollama installation and the `nomic-embed-text` model (downloaded locally).

Some source PDFs, private environment files, and locally built indexes may not be included in a Git clone. Do not assume the clone contains the data currently indexed in Pinecone. If no compatible populated Pinecone index is available, the UI/API can still be started, but grounded MOSDAC answers will not work until the approved corpus/index is provisioned.
