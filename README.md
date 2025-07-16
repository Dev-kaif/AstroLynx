# 🚀 AstroLynx: MOSDAC AI Assistant

AstroLynx is an intelligent, conversational AI assistant for **MOSDAC** (Meteorological and Oceanographic Satellite Data Archival Centre). It leverages a state-of-the-art RAG pipeline, a knowledge graph, and a real-time, continuous voice chat interface to provide an engaging and powerful user experience.

---

## ✨ Key Features

- **Advanced RAG Pipeline:** Delivers accurate, context-aware answers by combining multiple retrieval strategies:
  - **Hybrid Search:** Fuses results from vector search (**Pinecone**) and a knowledge graph (**Neo4j**).
  - **Query Transformation:** Rewrites user questions and generates hypothetical documents (**HyDE**) to retrieve the most relevant information.
  - **Intelligent Re-Ranking:** Uses Reciprocal Rank Fusion (**RRF**) to merge and rank results from parallel searches for optimal relevance.
- **Speech-to-Speech (STS) Interface:** Enables hands-free, continuous conversation.
  - **Voice-Activated:** Automatically detects when you stop speaking to process your query.
  - **Real-time STT/TTS:** Transcribes your voice to text, gets a response, and plays it back as audio using **Sarvam AI**.
- **Multi-Language Support:** Seamlessly converse in multiple languages, including English, Hindi, and Hinglish. AstroLynx automatically translates, processes, and responds in your chosen language.
- **Efficient & Logical Routing:** Saves time and compute by intelligently classifying queries. It handles simple greetings and general questions directly, engaging the complex RAG pipeline only for MOSDAC-related topics.
- **Persistent Conversations:** Uses **MongoDB** to store chat history, allowing you to pick up conversations right where you left off.
- **LangGraph Orchestration:** The entire AI workflow is managed by **LangGraph**, ensuring a robust and logical flow between retrieval, generation, and other services.

---

## 🛠️ Tech Stack

**Frontend:**

- React & Next.js
- TypeScript
- Tailwind CSS
- Framer Motion for animations
- Lucide React for icons

**Backend:**

- Node.js with Express
- **LangChain.js** for AI orchestration, featuring:
  - **LangGraph** for building stateful, multi-agent applications.
  - **Google Generative AI** (Gemini) for language models.
  - **Ollama** for running local embedding models (`nomic-embed-text`).
  - **Pinecone** for vector storage and search.
  - **Neo4j** for knowledge graph storage and queries.
  - **MongoDB** for chat history and session management.
- **Sarvam AI** for high-quality Text-to-Speech (TTS).

**Deployment & Tooling:**

- **Docker** for containerizing services like Ollama.
- `dotenv` for managing environment variables.
- `pnpm` for frontend package management.

---

## ⚡ Prerequisites

- Node.js (v18 or newer)
- A MongoDB Atlas cluster or a local MongoDB instance.
- A Pinecone account and API key.
- A Neo4j AuraDB instance or local installation.
- A Google Cloud Project with the Gemini API enabled.
- A Sarvam AI API key.
- **Docker** (required for running Ollama).

---

## 🪐 Setup & Installation

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/Dev-kaif/AstroLynx.git
cd AstroLynx
```

### 2️⃣ Configure Environment Variables

Create a `.env` file in the `Backend` directory and populate it with your credentials:

```env
# Google Gemini API Key
GEMINI_API_KEY="your_gemini_api_key"

# Pinecone Credentials
PINECONE_API_KEY="your_pinecone_api_key"

# MongoDB Connection URI
MONGO_URI="your_mongodb_connection_string"

# Neo4j Credentials
NEO4J_URI="your_neo4j_bolt_uri"
NEO4J_USERNAME="neo4j"
NEO4J_PASSWORD="your_neo4j_password"

# Sarvam AI API Key
SARVAM_AI_API_KEY="your_sarvam_api_key"

# Ollama URL (if running locally)
OLLAMA_BASE_URL="http://localhost:11434"
```

### 3️⃣ Set Up the Backend

```bash
# Navigate to the backend directory
cd Backend

# Install dependencies
npm install

# (Required) Start Ollama and pull the embedding model
docker run -d --rm -p 11434:11434 --name ollama ollama/ollama
docker exec ollama ollama pull nomic-embed-text

# Run the backend server
npm run dev
```

The backend server will start on its configured port (e.g., 5000).

### 4️⃣ Set Up the Frontend

```bash
# Navigate to the frontend directory from the root
cd Frontend

# Install dependencies
pnpm install

# Run the development server
pnpm dev
```

The frontend will be available at `http://localhost:3000`.

---

## 🛰️ Future Enhancements

- **Integrate a Dedicated VAD:** Implement a client-side Voice Activity Detection library for more precise and responsive turn-taking in audio conversations.
- **Streaming Responses:** Stream text from the LLM word-by-word for a more immediate response.
- **Advanced Audio Controls:** Add options for speaker selection and TTS parameter customization.
- **User Authentication:** Implement user accounts for persistent chat history across devices.
- **Expanded Knowledge Base:** Ingest more domain-specific datasets for even greater expertise.

---

## ❤️ Contributing

Contributions are welcome\! If you'd like to improve AstroLynx:

1.  Fork the repository.
2.  Create a new feature branch (`git checkout -b feature/your-feature-name`).
3.  Commit your changes with clear, descriptive messages.
4.  Push to the branch (`git push origin feature/your-feature-name`).
5.  Open a Pull Request.
