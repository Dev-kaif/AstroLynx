import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { invokeLLM, handleSimpleResponse } from "./ChatWithLLM";
import { AgentState, buildContext } from "./Memory";
import {
  queryTransformation,
  parallelRetrieval,
  rrfReRanking,
  retrieveFromNeo4j,
  classifyQuery,
} from "./Retrival";

const StateAnnotation = Annotation.Root({
  question: Annotation<string>(),
  chat_history: Annotation<any[]>({
    value: (left, right) => left.concat(right),
    default: () => [],
  }),
  retrieved_docs: Annotation<any[]>({
    value: (_, right) => right,
    default: () => [],
  }),
  neo4j_data: Annotation<string | null>({
    value: (_, right) => right,
    default: () => null,
  }),
  llm_response: Annotation<string | null>({
    value: (_, right) => right,
    default: () => null,
  }),
  context: Annotation<string | null>({
    value: (_, right) => right,
    default: () => null,
  }),
  rewritten_queries: Annotation<string[]>({
    value: (_, right) => right,
    default: () => [],
  }),
  hypothetical_doc_query: Annotation<string | null>({
    value: (_, right) => right,
    default: () => null,
  }),
  raw_pinecone_results: Annotation<any[][]>({
    value: (left, right) => left.concat(right),
    default: () => [],
  }),
  rrf_ranked_docs: Annotation<any[]>({
    value: (_, right) => right,
    default: () => [],
  }),
});

const routeQuery = (state: AgentState): string => {
  const classification = state.llm_response; // llm_response holds the classification
  console.log(
    `Routing based on classification (returning classification string): "${classification}"`
  );

  // Ensure we always return one of the expected classification strings
  if (classification === "greeting") {
    return "greeting";
  } else if (classification === "other") {
    return "other";
  } else if (classification === "mosdac") {
    return "mosdac";
  }
  return "other";
};

const workflow = new StateGraph(StateAnnotation)
  .addNode("classifyQuery", classifyQuery)
  .addNode("handleSimpleResponse", handleSimpleResponse) 
  .addNode("queryTransformation", queryTransformation)
  .addNode("parallelRetrieval", parallelRetrieval)
  .addNode("rrfReRanking", rrfReRanking)
  .addNode("retrieveFromNeo4j", retrieveFromNeo4j)
  .addNode("buildContext", buildContext)
  .addNode("invokeLLM", invokeLLM);

workflow.addEdge(START, "classifyQuery");

workflow.addConditionalEdges(
  "classifyQuery", 
  routeQuery, 
  {
    greeting: "handleSimpleResponse", 
    other: "handleSimpleResponse", 
    mosdac: "queryTransformation", 
  }
);

// Paths for simple responses
workflow.addEdge("handleSimpleResponse", END); 

// Existing RAG pipeline edges (only taken if classification is "mosdac")
workflow.addEdge("queryTransformation", "parallelRetrieval");
workflow.addEdge("queryTransformation", "retrieveFromNeo4j");
workflow.addEdge("parallelRetrieval", "rrfReRanking");
workflow.addEdge("rrfReRanking", "buildContext");
workflow.addEdge("retrieveFromNeo4j", "buildContext");
workflow.addEdge("buildContext", "invokeLLM");
workflow.addEdge("invokeLLM", END);

export const graph = workflow.compile();