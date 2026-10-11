// Services/LangGraphChain.ts
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { BaseMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";
import { invokeLLM, handleSimpleResponse } from "./ChatWithLLM";
import { AgentState, EvidenceCitation, buildContext } from "./Memory";
import {
  queryTransformation,
  parallelRetrieval,
  rrfReRanking,
  classifyQuery,
} from "./Retrival";


import { convertTextToSpeech } from "./textToSpeech";

const StateAnnotation = Annotation.Root({
  question: Annotation<string>(),
  chat_history: Annotation<BaseMessage[]>({
    // main.chat() reloads the bounded, authoritative history from MongoDB for
    // every turn. Appending checkpoint state here duplicates prior turns.
    value: (_, right) => right,
    default: () => [],
  }),
  retrieved_docs: Annotation<Document[]>({
    value: (_, right) => right,
    default: () => [],
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
  raw_pinecone_results: Annotation<Document[][]>({
    // Retrieval is performed anew for each user turn; old ranked lists must
    // not leak into this turn's RRF or evidence context.
    value: (_, right) => right,
    default: () => [],
  }),
  raw_lexical_results: Annotation<Document[][]>({
    value: (_, right) => right,
    default: () => [],
  }),
  rrf_ranked_docs: Annotation<Document[]>({
    value: (_, right) => right,
    default: () => [],
  }),
  imageData: Annotation<string | null>({
    value: (_, right) => right,
    default: () => null,
  }),
  targetLanguage: Annotation<string | null>({
    value: (_, right) => right,
    default: () => null,
  }),
  isAudioMode: Annotation<boolean | null>({
    value: (_, right) => right,
    default: () => null,
  }),
  audioData: Annotation<string | null>({
    value: (_, right) => right,
    default: () => null,
  }),
  citations: Annotation<EvidenceCitation[]>({
    value: (_, right) => right,
    default: () => [],
  }),
});

const generateAudioNode = async (
  state: AgentState,
  config: RunnableConfig
): Promise<Partial<AgentState>> => {
  console.log("LangGraph Node: generateAudioNode");
  const { llm_response, targetLanguage } = state;

  if (state.isAudioMode && llm_response) {
    console.log(
      "[Graph] Audio mode active: Generating speech from AI response."
    );
    try {
      // Directly call the core TTS conversion function
      const audioData = await convertTextToSpeech(
        llm_response,
        targetLanguage || "en",
        undefined,
        config.signal
      ); // Provide a default language if targetLanguage is null

      if (audioData) {
        console.log("[Graph] Audio data generated successfully.");
        return { audioData: audioData };
      } else {
        console.warn("[Graph] TTS generated no audio data.");
        return { audioData: null };
      }
    } catch (ttsError: unknown) {
      if (config.signal?.aborted) throw ttsError;
      console.error(
        `[Graph] Speech generation failed: ${ttsError instanceof Error ? ttsError.name : "unknown error"}`
      );
      return { audioData: null };
    }
  }
  return { audioData: null };
};

// --- Conditional Routing Functions ---

const routeQuery = (state: AgentState): string => {
  const classification = state.llm_response; // llm_response holds the classification

  console.log(
    `Routing based on classification (returning classification string): "${classification}"`
  );

  if (classification === "greeting") {
    return "handleSimpleResponse";
  } else if (classification === "other") {
    return "handleSimpleResponse";
  } else if (classification === "mosdac") {
    return "queryTransformation";
  }

  console.warn(
    `Unexpected classification: "${classification}". Defaulting to "handleSimpleResponse".`
  );
  return "handleSimpleResponse";
};

const routeAfterLLM = (state: AgentState): string => {
  if (state.isAudioMode) {
    console.log(
      "[Graph Router] Routing directly to generateAudioNode (no output translation, audio mode active)."
    );
    return "generateAudio";
  }
  console.log(
    "[Graph Router] Routing to END (no output translation, no audio)."
  );
  return END;
};

// --- LangGraph Workflow Definition ---
let workflow = new StateGraph(StateAnnotation)
  .addNode("classifyQuery", classifyQuery)
  .addNode("handleSimpleResponse", handleSimpleResponse)
  .addNode("queryTransformation", queryTransformation)
  .addNode("parallelRetrieval", parallelRetrieval)
  .addNode("rrfReRanking", rrfReRanking)
  .addNode("buildContext", buildContext)
  .addNode("invokeLLM", invokeLLM)
  .addNode("generateAudio", generateAudioNode);

workflow.addEdge(START, "classifyQuery");

workflow.addConditionalEdges("classifyQuery", routeQuery, {
  handleSimpleResponse: "handleSimpleResponse",
  queryTransformation: "queryTransformation",
});

workflow.addConditionalEdges("handleSimpleResponse", routeAfterLLM, {
  generateAudio: "generateAudio",
  [END]: END,
});

workflow.addEdge("queryTransformation", "parallelRetrieval");
workflow.addEdge("parallelRetrieval", "rrfReRanking");
workflow.addEdge("rrfReRanking", "buildContext");
workflow.addEdge("buildContext", "invokeLLM");

workflow.addConditionalEdges("invokeLLM", routeAfterLLM, {
  generateAudio: "generateAudio",
  [END]: END,
});

workflow.addEdge("generateAudio", END);

export let graph: ReturnType<typeof workflow.compile> | null = null;

export function compileGraph() {
  graph = workflow.compile();
  console.log("LangGraph compiled without persistent turn checkpoints.");
}
