# AstroLynx: MOSDAC AI Assistant

AstroLynx is an intelligent AI assistant focused on **MOSDAC**, satellite data, Earth observation, and space missions. It combines a powerful RAG pipeline, knowledge graph, multi-language support, and real-time audio for an engaging, productive assistant experience.

---

## 🚀 Key Features

* **Intelligent Q\&A:** Answers your questions from a rich, curated knowledge base.
* **Retrieval-Augmented Generation (RAG):** Combines vector search (Pinecone) with knowledge graph (Neo4j).

  * **HyDE:** Generates hypothetical documents for better retrieval coverage.
  * **Parallel Query Translation (Fan-out):** Runs multiple retrieval paths in parallel.
  * **Reciprocal Rank Fusion (RRF):** Merges results for the best relevance.
* **Neo4j Knowledge Graph:** Understands and reasons about complex relationships.
* **Multi-language Support:** Automatically translates user input to English, processes it, and returns AI responses in the user's language (including Hinglish).
* **Logical Routing for Efficiency:** Detects greetings, MOSDAC-specific queries, and general queries, skipping unnecessary RAG/database calls to save compute and time.
* **Audio Chat Interface:**

  * **Voice Activity Detection (VAD):** Starts listening when you speak.
  * **Text-to-Speech (TTS):** Plays AI responses back using Sarvam AI.
  * *(Future: Speech-to-Text (STT) for voice input.)*
* **Chat History:** Stores conversations in MongoDB for continuity.
* **LangGraph Orchestration:** Manages the AI workflow, routing between retrieval, graph, and generation steps efficiently.

---

## 🛠 Technologies Used

**Frontend:**

* React with Next.js
* Tailwind CSS
* Framer Motion
* Lucide React
* `axios`

**Backend:**

* Node.js with Express
* LangChain.js with:

  * Google Generative AI
  * Pinecone
  * Ollama for embeddings (optional, local)
  * MongoDB
  * LangGraph
  * Neo4j Graph
* Sarvam AI TTS API
* `dotenv` for environment management

**Containerization:**

* **Docker** (recommended for Ollama and local LLM hosting)

---

## ⚡ Setup Prerequisites

* Node.js (v18+)
* MongoDB Atlas or local MongoDB
* Pinecone account
* Neo4j AuraDB or local Neo4j
* Google Cloud Project with Gemini API enabled
* Sarvam AI API key
* (Optional) Ollama + Docker for local embeddings

---

## 🪐 Setup Steps

### 1️⃣ Environment Variables

Create a `.env` file in your `Backend` directory with:

```
GEMINI_API_KEY=your_gemini_key
PINECONE_API_KEY=your_pinecone_key
MONGO_URI=your_mongo_uri
NEO4J_URI=your_neo4j_uri
SARVAM_API_KEY=your_sarvam_key
OLLAMA_BASE_URL=http://localhost:11434 (optional)
```

### 2️⃣ Backend Setup

```bash
cd Backend
npm install
npm run dev
```

*If using Ollama, ensure it is running and the `nomic-embed-text` model is pulled.*

### 3️⃣ Frontend Setup

```bash
cd Frontend
pnpm install
npm run dev
```

---

## 🛰 Usage

1. Start backend and frontend servers.
2. Open your browser and navigate to:

   ```
   http://localhost:3000
   ```
3. Start chatting with AstroLynx.

---

## ⚠️ Important Notes

* **Security:** Do not commit `.env` files or API keys to your repository. Use `.gitignore` to keep them out of version control.
* **Future Enhancements:**

  * Re-enable Speech-to-Text (STT) for voice input.
  * Add speaker selection and TTS parameter customization.
  * Streaming responses for Gemini/LLM.
  * More domain datasets for Earth observation and satellite-specific queries.
  * User authentication and persistent chat sessions across devices.
  * UI/UX enhancements for mobile and tablet support.

---

## ❤️ Contributing

If you’d like to improve AstroLynx:

* Fork this repository
* Create a feature branch
* Open a pull request with clear, descriptive commits
