// Services/Retrival.ts
import { AgentState } from "./Memory";
import { pineconeVectorStore, neo4jDriver, chatLLM, embeddings } from "./initializeChatService";
import { Document } from "@langchain/core/documents";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser, StringOutputParser } from "@langchain/core/output_parsers"; // Import StringOutputParser

// --- Helper for Reciprocal Rank Fusion (RRF) ---
const RRF_K = 60; // A common constant, can be tuned

export function reciprocalRankFusion(
  rankedLists: Document[][],
  k: number = RRF_K
): Document[] {
  const scores: { [id: string]: number } = {};
  const docMap: { [id: string]: Document } = {};

  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const doc = list[i];
      // Create a unique identifier for the document for scoring purposes.
      const docId = `${doc.pageContent}_${doc.metadata.source || 'unknown'}`;

      if (!docMap[docId]) {
        docMap[docId] = doc;
      }

      const rank = i + 1;
      scores[docId] = (scores[docId] || 0) + 1.0 / (k + rank);
    }
  }

  const sortedDocs = Object.keys(scores)
    .sort((a, b) => scores[b] - scores[a])
    .map((docId) => docMap[docId]);

  return sortedDocs;
}

// --- Individual Retrieval Functions ---

// This function performs a single vector search
export async function retrieveFromVectorDB(
  query: string // This function takes a single query string, as used by parallelRetrieval
): Promise<Document[]> {
  console.log(`Retrieving from Pinecone for query: "${query}"`);
  if (!pineconeVectorStore) {
    console.warn(
      "Pinecone Vector Store not initialized. Skipping vector retrieval."
    );
    return [];
  }

  try {
    const results = await pineconeVectorStore.similaritySearch(
      query,
      5 // Adjusted to retrieve top 5 documents for each sub-query for diversity
    );
    results.forEach(doc => doc.metadata.source = doc.metadata.source || 'pinecone_vector'); // Tag source
    console.log(`Retrieved ${results.length} documents from Pinecone for query: "${query}"`);
    return results;
  } catch (e: any) {
    console.error(`Error during vector retrieval for query "${query}": ${e.message || e}`);
    return [];
  }
}

// --- Neo4j Retrieval (Semantic Search Version) ---
export async function retrieveFromNeo4j(
  state: AgentState // Takes the full state to access question
): Promise<Partial<AgentState>> { // Returns Partial<AgentState> to update neo4j_data
  console.log("LangGraph Node: retrieveFromNeo4j (Semantic Search)");

  if (!neo4jDriver) {
    console.warn("Neo4j Driver not initialized. Skipping Neo4j retrieval.");
    return { neo4j_data: "No Neo4j data available due to uninitialized driver." };
  }
  if (!embeddings) {
    console.error("Embeddings instance not initialized for Neo4j semantic retrieval.");
    return { neo4j_data: "Embeddings unavailable for Neo4j semantic search." };
  }
  
  const session = neo4jDriver.session(); // Use session directly
  let neo4jData = "";

  try {
    // 1️⃣ Embed the user’s question
    const questionEmbedding = await embeddings.embedQuery(state.question);

    // 2️⃣ Semantic search to get top matching nodes
    // Ensure 'content_vector_index_object' exists and is populated in your Neo4j DB
    const vectorResult = await session.run(
      `
      CALL db.index.vector.queryNodes('content_vector_index_object', 5, $embedding)
      YIELD node, score
      RETURN id(node) AS nodeId, labels(node) AS labels, score
      `,
      { embedding: questionEmbedding }
    );

    if (vectorResult.records.length === 0) {
      console.log("No relevant nodes found in Neo4j semantic search.");
      return { neo4j_data: "No relevant semantic nodes found in Neo4j." };
    }

    // 3️⃣ For each retrieved node, fetch readable relations
    neo4jData = "Neo4j Semantic Relations Retrieved:\n";

    for (const [idx, record] of vectorResult.records.entries()) {
      const nodeId = record.get("nodeId").toNumber?.() ?? record.get("nodeId");
      const labels = record.get("labels");
      const score = record.get("score");

      neo4jData += `\n${idx + 1}) Node ID: ${nodeId}, Labels: ${labels.join(", ")}, Score: ${score}\n`;

      const relationResult = await session.run(
        `
        MATCH (n)-[r]-(m)
        WHERE id(n) = $nodeId
        RETURN
          type(r) AS relationType,
          labels(m) AS targetLabels,
          coalesce(m.name, m.title, m.id, "Unknown") AS targetName,
          labels(n) AS sourceLabels,
          coalesce(n.name, n.title, n.id, "Unknown") AS sourceName
        LIMIT 10
        `,
        { nodeId }
      );

      if (relationResult.records.length === 0) {
        neo4jData += `   No relations found.\n`;
      } else {
        relationResult.records.forEach((relRec) => {
          const relType = relRec.get("relationType");
          const sourceName = relRec.get("sourceName");
          const targetName = relRec.get("targetName");

          neo4jData += `   ${sourceName} --> ${relType} --> ${targetName}\n`;
        });
      }
    }

    console.log("Neo4j semantic relations retrieved successfully. =>>\n", neo4jData, "\n");

  } catch (e: any) {
    console.error(`Error during Neo4j semantic retrieval: ${e.message || e}`);
    neo4jData = `Error retrieving semantic relations from Neo4j: ${e.message || e}`;
  } finally {
    if (session) {
      await session.close();
    }
  }

  return { neo4j_data: neo4jData };
}

// --- New Nodes for Advanced Retrieval (HyDE, Fanout, RRF) ---

export async function queryTransformation(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log("LangGraph Node: queryTransformation (HyDE & Fanout)");
  if (!chatLLM) {
    console.warn("LLM not initialized for query transformation.");
    return { rewritten_queries: [state.question], hypothetical_doc_query: state.question };
  }

  interface TransformationOutput {
    rewritten_queries: string[];
    hypothetical_document: string;
  }

  const transformationPrompt = PromptTemplate.fromTemplate(`
You are an AI assistant tasked with generating diverse search queries and a hypothetical document to improve information retrieval.
Given the user's original question, perform two tasks:
1. Generate 3-5 alternative phrasings or expansions of the original question. These should be distinct but semantically similar.
2. Generate a concise, hypothetical ideal answer to the question. This answer should be what you would expect to see in a relevant document.

You MUST format your response as a JSON object with two keys: "rewritten_queries" (an array of strings) and "hypothetical_document" (a string).
Do NOT include any other text or formatting outside the JSON object.

Example:
Question: "What is the purpose of the Chandrayaan-3 mission?"
Output:
{
  "rewritten_queries": [
    "Chandrayaan-3 mission objectives",
    "Goals of India's Chandrayaan-3 lunar mission",
    "What was Chandrayaan-3 designed to achieve?",
    "Key aims of Chandrayaan-3"
  ],
  "hypothetical_document": "The Chandrayaan-3 mission's primary purpose is to demonstrate safe lunar landing and roving capabilities, and to conduct in-situ scientific experiments on the lunar surface."
}

Question: {question}
Output:
`);

  try {
    const chain = transformationPrompt.pipe(chatLLM).pipe(new JsonOutputParser<TransformationOutput>());
    
    const parsedResponse = await chain.invoke({ question: state.question });

    const rewrittenQueries = parsedResponse.rewritten_queries || [];
    const hypotheticalDoc = parsedResponse.hypothetical_document || "";

    const allQueriesForSearch = [state.question, ...rewrittenQueries];
    if (hypotheticalDoc) {
        allQueriesForSearch.push(hypotheticalDoc);
    }

    console.log("Generated queries for fanout:", allQueriesForSearch);
    console.log("Generated hypothetical document:", hypotheticalDoc);

    return {
      rewritten_queries: allQueriesForSearch,
      hypothetical_doc_query: hypotheticalDoc,
    };
  } catch (e: any) {
    console.error(`Error during query transformation: ${e.message || e}`);
    return {
      rewritten_queries: [state.question], // Fallback to original question
      hypothetical_doc_query: state.question, // Fallback
    };
  }
}

export async function parallelRetrieval(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log("LangGraph Node: parallelRetrieval");
  const queriesToSearch = state.rewritten_queries || [state.question];

  const retrievalPromises = queriesToSearch.map(query => retrieveFromVectorDB(query));

  try {
    const rawResults = await Promise.all(retrievalPromises);
    console.log(`Completed ${rawResults.length} parallel retrievals.`);
    return { raw_pinecone_results: rawResults };
  } catch (e: any) {
    console.error(`Error during parallel retrieval: ${e.message || e}`);
    return { raw_pinecone_results: [] };
  }
}

export async function rrfReRanking(
  state: AgentState
): Promise<Partial<AgentState>> {
  
  console.log("LangGraph Node: rrfReRanking");
  if (!state.raw_pinecone_results || state.raw_pinecone_results.length === 0) {
    console.warn("No raw Pinecone results to re-rank with RRF.");
    return { rrf_ranked_docs: [] };
  }

  const rrfResults = reciprocalRankFusion(state.raw_pinecone_results);
  console.log(`Re-ranked ${rrfResults.length} documents using RRF.`);
  return { rrf_ranked_docs: rrfResults };
}

// New function for query classification
// Services/Retrival.ts
// ... (rest of your imports and code above classifyQuery) ...

// New function for query classification
export async function classifyQuery(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log("LangGraph Node: classifyQuery (Routing)");
  if (!chatLLM) {
    console.warn("LLM not initialized for query classification.");
    return { llm_response: "other" }; // Default to "other" if LLM is not ready
  }

  const classificationPrompt = PromptTemplate.fromTemplate(`
You are an AI assistant whose ONLY task is to classify user queries into one of three predefined categories.
You MUST respond with ONLY ONE WORD, which is the category name. No other text, no punctuation, no explanations.

The categories are:
- "greeting": If the user's question is a simple salutation or friendly opening (e.g., "Hi", "Hello", "How are you?", "Good morning", "Hey there").
- "mosdac": If the user's question is directly or indirectly related to MOSDAC, satellite data, space missions, ISRO, Earth observation, or any scientific/technical information you would find in a MOSDAC context.
- "other": If the user's question falls into none of the above categories (e.g., general knowledge, personal questions, completely irrelevant topics).

Examples:
Question: "Hi there!"
Classification: greeting

Question: "Tell me about INSAT-3D."
Classification: mosdac

Question: "What's the weather like today?"
Classification: other

Question: "How do I make a cake?"
Classification: other

Question: "What is MOSDAC?"
Classification: mosdac

Question: "Good afternoon, AstroLynx!"
Classification: greeting

Question: {question}
Classification:
`);

  try {
    const chain = classificationPrompt.pipe(chatLLM).pipe(new StringOutputParser());
    
    const rawResponse = await chain.invoke({ question: state.question });
    
    let classification = rawResponse ? rawResponse.toLowerCase().trim() : "other";

    // Reinforce validation: ensure it's one of the expected categories
    if (!["greeting", "mosdac", "other"].includes(classification)) {
      console.warn(`LLM returned unexpected classification: "${classification}". Forcing to "other".`);
      classification = "other"; // Force to "other" if it's not one of the expected
    }

    console.log(`Query classified as: "${classification}"`);
    return { llm_response: classification };
  } catch (e: any) {
    console.error(`Error during query classification: ${e.message || e}`);
    return { llm_response: "other" }; // Fallback to "other" on error
  }
}