import { AgentState } from "./Memory";
import { pineconeVectorStore } from "./initializeChatService";


// import { BaseMessage } from "@langchain/core/messages";
// import { Document } from "@langchain/core/documents";
// import { chatLLM, embeddings, neo4jDriver } from "./initializeChatService";
// import { Session } from "neo4j-driver";



export async function retrieveFromVectorDB(
  state: AgentState
): Promise<Partial<AgentState>> {

  console.log("LangGraph Node: retrieveFromVectorDB");
  
  if (!pineconeVectorStore) {
    console.warn(
      "Pinecone Vector Store not initialized. Skipping vector retrieval."
    );
    return { retrieved_docs: [] };
  }

  try {
    // Perform similarity search
    const results = await pineconeVectorStore.similaritySearch(
      state.question,
      10
    ); // Retrieve top 10

    // console.log(`Retrieved ${results.length} documents from Pinecone ${results}.`);
    return { retrieved_docs: results };
  } catch (e: any) {
    console.error(`Error during vector retrieval: ${e.message || e}`);
    return { retrieved_docs: [] };
  }
}


/*
async function retrieveFromNeo4j(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log("LangGraph Node: retrieveFromNeo4j");

  if (!neo4jDriver) {
    console.warn("Neo4j Driver not initialized. Skipping Neo4j retrieval.");
    return { neo4j_data: "No Neo4j data available." };
  }

  if (!embeddings) {
    console.error("Embeddings instance not initialized for Neo4j semantic retrieval.");
    return { neo4j_data: "Embeddings unavailable." };
  }

  const session: Session = neo4jDriver.session();
  let neo4jData = "No semantic relations found in Neo4j.";

  try {
    // 1️⃣ Embed the user’s question
    const questionEmbedding = await embeddings.embedQuery(state.question);

    // 2️⃣ Semantic search to get top matching nodes
    const vectorResult = await session.run(
      `
      CALL db.index.vector.queryNodes('content_vector_index_object', 5, $embedding)
      YIELD node, score
      RETURN id(node) AS nodeId, labels(node) AS labels, score
      `,
      { embedding: questionEmbedding }
    );

    if (vectorResult.records.length === 0) {
      console.log("No relevant nodes found in semantic search.");
      return { neo4j_data: "No relevant semantic nodes found." };
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

    console.log("\n\n\n\n\n✅ Neo4j relations retrieved successfully. =>> ",neo4jData,"\n\n\n");

  } catch (e: any) {
    console.error(`Error during Neo4j semantic retrieval: ${e.message || e}`);
    neo4jData = "Error retrieving semantic relations from Neo4j.";
  } finally {
    await session.close();
  }

  return { neo4j_data: neo4jData };
}
*/
