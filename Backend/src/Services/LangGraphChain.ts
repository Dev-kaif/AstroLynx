// Services/LangGraphChain.ts
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

import { checkpointer } from "./initializeChatService"; // Import checkpointer

import { translateToEnglish, translateToTargetLanguage } from "./translateText";
import { textToSpeechController } from "../Controllers/textToSpeechController";

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
});


const translateUserInputNode = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  console.log("LangGraph Node: translateUserInputNode");
  const { question, targetLanguage } = state;

  if (targetLanguage && targetLanguage !== "en" && question) {
    try {
      const translatedQuestion = await translateToEnglish(
        question,
        targetLanguage
      );
      console.log(
        `[Graph] User input translated to English: "${translatedQuestion.substring(
          0,
          50
        )}..."`
      );
      return { question: translatedQuestion };
    } catch (error) {
      console.error(
        "[Graph] Error translating user input to English, proceeding with original:",
        error
      );
      return { question: question };
    }
  }
  return { question: question };
};

const translateOutputNode = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  console.log("LangGraph Node: translateOutputNode");
  const { llm_response, targetLanguage } = state;

  if (targetLanguage && targetLanguage !== "en" && llm_response) {
    try {
      const translatedResponse = await translateToTargetLanguage(
        llm_response,
        targetLanguage
      );
      console.log(
        `[Graph] LLM response translated to ${targetLanguage}: "${translatedResponse.substring(
          0,
          50
        )}..."`
      );
      return { llm_response: translatedResponse };
    } catch (error) {
      console.error(
        "[Graph] Error translating LLM output to target language, proceeding with English:",
        error
      );
      return { llm_response: llm_response };
    }
  }
  return { llm_response: llm_response };
};

const generateAudioNode = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  console.log("LangGraph Node: generateAudioNode");
  const { llm_response, targetLanguage } = state;

  if (state.isAudioMode && llm_response) {
    console.log(
      "[Graph] Audio mode active: Generating speech from AI response."
    );
    const mockReq: any = {
      body: {
        text: llm_response,
        target_language_code: targetLanguage,
        speaker: "anushka",
      },
    };
    const mockRes: any = {
      json: (data: any) => {
        mockRes._data = data;
        return mockRes;
      },
      status: (code: number) => {
        if (code !== 200) {
          console.error(
            `Sarvam AI TTS mock response status: ${code}. Data: ${JSON.stringify(
              mockRes._data
            )}`
          );
        }
        mockRes._status = code;
        return mockRes;
      },
      send: (data: any) => {
        mockRes._data = data;
        return mockRes;
      },
      set: () => mockRes,
    };

    try {
      await textToSpeechController(mockReq, mockRes);
      const audioData = mockRes._data?.audioData;
      if (audioData) {
        console.log("[Graph] Audio data generated successfully.");
        return { audioData: audioData };
      } else {
        console.warn("[Graph] TTS generated no audio data.");
        return { audioData: null };
      }
    } catch (ttsError: any) {
      console.error(
        `[Graph] Error generating speech: ${ttsError.message || ttsError}`
      );
      return { audioData: null };
    }
  }
  return { audioData: null };
};

// --- Conditional Routing Functions ---

// The routeQuery function already returns the correct node names (handleSimpleResponse, queryTransformation)
// The issue is with the keys in the addConditionalEdges map for 'classifyQuery'
const routeQuery = (state: AgentState): string => {
  const classification = state.llm_response; // llm_response holds the classification

  console.log(
    `Routing based on classification (returning classification string): "${classification}"`
  );

  // These return values are used as keys in the addConditionalEdges map
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

const routeAfterStart = (state: AgentState): string => {
  if (state.targetLanguage && state.targetLanguage !== "en") {
    console.log("[Graph Router] Routing to translateUserInputNode.");
    return "translateUserInput";
  }
  console.log(
    "[Graph Router] Routing directly to classifyQuery (no input translation)."
  );
  return "classifyQuery";
};

const routeAfterLLM = (state: AgentState): string => {
  if (state.targetLanguage && state.targetLanguage !== "en") {
    console.log("[Graph Router] Routing to translateOutputNode.");
    return "translateOutput";
  }
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

const routeAfterOutputTranslation = (state: AgentState): string => {
  if (state.isAudioMode) {
    console.log(
      "[Graph Router] Routing to generateAudioNode (audio mode active)."
    );
    return "generateAudio";
  }
  console.log("[Graph Router] Routing to END (no audio).");
  return END;
};

// --- LangGraph Workflow Definition ---
let workflow = new StateGraph(StateAnnotation)
  .addNode("translateUserInput", translateUserInputNode)
  .addNode("classifyQuery", classifyQuery)
  .addNode("handleSimpleResponse", handleSimpleResponse)
  .addNode("queryTransformation", queryTransformation)
  .addNode("parallelRetrieval", parallelRetrieval)
  .addNode("rrfReRanking", rrfReRanking)
  .addNode("retrieveFromNeo4j", retrieveFromNeo4j)
  .addNode("buildContext", buildContext)
  .addNode("invokeLLM", invokeLLM)
  .addNode("translateOutput", translateOutputNode)
  .addNode("generateAudio", generateAudioNode);


workflow.addConditionalEdges(START, routeAfterStart, {
  translateUserInput: "translateUserInput",
  classifyQuery: "classifyQuery",
});

workflow.addEdge("translateUserInput", "classifyQuery");

workflow.addConditionalEdges("classifyQuery", routeQuery, {
  handleSimpleResponse: "handleSimpleResponse", 
  queryTransformation: "queryTransformation", 
});

workflow.addConditionalEdges("handleSimpleResponse", routeAfterLLM, {
  translateOutput: "translateOutput",
  generateAudio: "generateAudio",
  [END]: END,
});

workflow.addEdge("queryTransformation", "parallelRetrieval");
workflow.addEdge("queryTransformation", "retrieveFromNeo4j");
workflow.addEdge("parallelRetrieval", "rrfReRanking");
workflow.addEdge("rrfReRanking", "buildContext");
workflow.addEdge("retrieveFromNeo4j", "buildContext");
workflow.addEdge("buildContext", "invokeLLM");

workflow.addConditionalEdges("invokeLLM", routeAfterLLM, {
  translateOutput: "translateOutput",
  generateAudio: "generateAudio",
  [END]: END,
});

workflow.addConditionalEdges("translateOutput", routeAfterOutputTranslation, {
  generateAudio: "generateAudio",
  [END]: END,
});

workflow.addEdge("generateAudio", END);

export let graph: any;

export function compileGraph() {
  if (!checkpointer) {
    console.error("Checkpointer is not initialized. Cannot compile graph.");
    return;
  }
  graph = workflow.compile({
    checkpointer: checkpointer,
  });
  console.log("LangGraph compiled with checkpointer.");
}
