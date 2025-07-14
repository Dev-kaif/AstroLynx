**AstroLynx: MOSDAC AI Assistant**

AstroLynx is an intelligent AI assistant focused on MOSDAC, satellite data, Earth observation, and space missions. It uses a powerful RAG pipeline, knowledge graph, multi-language support, and real-time audio.

---

**Key Features:**

- **Intelligent Q\&A:** Answers questions from a comprehensive knowledge base.
- **Retrieval-Augmented Generation (RAG):** Combines vector search (Pinecone) and knowledge graph (Neo4j).
  - **HyDE:** Uses hypothetical documents for better retrieval.
  - **Parrael Query translation (Fan-out method):** Executes parallel retrieval paths.
  - **Reciprocal Rank Fusion (RRF):** Merges results from different sources for optimal relevance.
- **Neo4j Knowledge Graph:** Understands complex relationships.
- **Multi-language Support:** Translates user input to English for processing and AI output back to the user's language (including Hinglish).
- **Logical Routing for Efficiency:** Classifies queries (greeting, MOSDAC, other) to skip unnecessary database calls and RAG steps, optimizing performance.
- **Audio Chat Interface:**
  - **Voice Activity Detection (VAD):** Detects when you speak.
  - **Text-to-Speech (TTS):** Converts AI responses to audio using Sarvam AI (implemented on the backend).
  - _(Future: Speech-to-Text (STT) for voice input.)_
- **Chat History:** Stores conversations using MongoDB.
- **LangGraph Orchestration:** Manages the complex AI workflow.

---

**Technologies Used:**

- **Frontend (React with Next.js):** React, Next.js, Tailwind CSS, Framer Motion, Lucide React, `axios`.
- **Backend (Node.js with Express):** Node.js, Express.js, LangChain.js (with Google Generative AI, Pinecone, Ollama for embeddings, MongoDB, LangGraph, Neo4j Graph), MongoDB, Pinecone, Neo4j, Sarvam AI TTS API, `axios`, `dotenv`.
- **Docker:** Can be used to containerize Ollama for local LLM and embedding model hosting.

---

**Setup Prerequisites:**

- Node.js (v18+)
- MongoDB Atlas (or local MongoDB)
- Pinecone account
- Neo4j AuraDB (or local Neo4j)
- Google Cloud Project (Gemini API enabled)
- Sarvam AI API key
- **Ollama (Optional):** For local embeddings. Docker is recommended for running Ollama.

---

**Setup Steps:**

1.  **Environment Variables:** Create a `.env` file in the `Backend` directory with your API keys and connection strings (e.g., `GEMINI_API_KEY`, `PINECONE_API_KEY`, `MONGO_URI`, `NEO4J_URI`, `SARVAM_API_KEY`, and optional `OLLAMA_BASE_URL`).
2.  **Backend Setup:**
    ```bash
    cd Backend
    npm install
    npm run dev
    ```
    _(If using Ollama, start it and pull an embedding model like `nomic-embed-text`.)_
3.  **Frontend Setup:**
    ```bash
    cd Frontend
    pnpm install
    npm run dev
    ```

---

**Usage:**

1.  Start both backend and frontend servers.
2.  Go to `http://localhost:3000` in your browser.
3.  START CHATING

---

**Important Notes:**

- **Security:** NEVER commit API keys directly to your code. Use `.env` files and `.gitignore`.
- **Future:** We plan to re-enable Speech-to-Text, add speaker selection, customizable TTS parameters, streaming responses, more domain data, user authentication, and UI/UX enhancements.
