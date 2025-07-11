import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";
import { ChatOllama } from "@langchain/ollama";
dotenv.config();

async function generateCypher(
  llm: ChatOllama,
  question: string
) {


    const SystemPrompt = `
You are a Neo4j Cypher generator specialized in **creating data**.  
Given a text chunk and a schema, output exactly one **multi-line MERGE block** to:

1. MERGE all relevant nodes mentioned in the chunk.
2. MERGE the relationship(s) between those nodes inferred from the text.
3. Use only the labels and relationship types.
4. Output **only the Cypher**, no commentary or formatting.
5. Use Consistent naming

Examples:

Chunk: "there was king who ruled france named kaif"
Schema:
(User {name})-[:RULES_OVER]->(Country {name})
(Title {name})-[:HELD_BY]->(User {name})
Cypher:
MERGE (u:User {name: "kaif"})
MERGE (t:Title {name: "king"})
MERGE (c:Country {name: "france"})
MERGE (t)-[:HELD_BY]->(u)
MERGE (u)-[:RULES_OVER]->(c);

Chunk: "alice is the queen of wonderland"
Schema:
(User {name})-[:RULES_OVER]->(Country {name})
(Title {name})-[:HELD_BY]->(User {name})
Cypher:
MERGE (u:User {name: "alice"})
MERGE (t:Title {name: "queen"})
MERGE (c:Country {name: "wonderland"})
MERGE (t)-[:HELD_BY]->(u)
MERGE (u)-[:RULES_OVER]->(c);

Chunk: "bob, a president, governed the united_states"
Schema:
(User {name})-[:RULES_OVER]->(Country {name})
(Title {name})-[:HELD_BY]->(User {name})
Cypher:
MERGE (u:User {name: "bob"})
MERGE (t:Title {name: "president"})
MERGE (c:Country {name: "united_states"})
MERGE (t)-[:HELD_BY]->(u)
MERGE (u)-[:RULES_OVER]->(c);

Chunk: "emma served as empress of the roman_empire"
Schema:
(User {name})-[:RULES_OVER]->(Country {name})
(Title {name})-[:HELD_BY]->(User {name})
Cypher:
MERGE (u:User {name: "emma"})
MERGE (t:Title {name: "empress"})
MERGE (c:Country {name: "roman_empire"})
MERGE (t)-[:HELD_BY]->(u)
MERGE (u)-[:RULES_OVER]->(c);

Now apply this to:

Chunk:
${question}
Cypher:

`



  const res = await llm.invoke([{ role: "user", content: SystemPrompt }]);
  return res.content;
}

async function pipeline(pdfDir: string) {
  const files = await fs.readdir(pdfDir);
  const pdfs = files.filter(f => f.endsWith(".pdf"));
  if (!pdfs.length) return console.warn("No PDFs found.");

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
  const llm = new ChatOllama({
    baseUrl: "http://localhost:11434",
    model: "hf.co/avinashm/text2cypher",
    temperature: 0,
    streaming: false
  });

//   const graph = await Neo4jGraph.initialize({
//     url: process.env.NEO4J_URI!,
//     username: process.env.NEO4J_USERNAME!,
//     password: process.env.NEO4J_PASSWORD!
//   });


  for (const f of pdfs) {
    const docs = await new PDFLoader(path.join(pdfDir, f)).load();
    const chunks = await splitter.splitDocuments(docs);

    for (const chunk of chunks) {
      const cypher = await generateCypher(llm, chunk.pageContent);
      console.log("🔧 Generated Cypher:", cypher);

    }
  }

//   await graph.close();
}

pipeline(path.resolve(__dirname, "../PDF")).catch(e => console.error("❌ Pipeline error:", e));
