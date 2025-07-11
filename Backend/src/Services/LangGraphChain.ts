import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { invokeLLM } from "./ChatWithLLM";
import { buildContext } from "./Memory";
import { retrieveFromVectorDB } from "./Retrival";

const StateAnnotation = Annotation.Root({
  question: Annotation<string>(),
  chat_history: Annotation<any[]>({
    value: (left, right) => left.concat(right),
    default: () => [],
  }),
  retrieved_docs: Annotation<any[]>({
    value: (left, right) => left.concat(right),
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
});

const workflow = new StateGraph(StateAnnotation)
  .addNode("retrieveVector", retrieveFromVectorDB)
  .addNode("buildContext", buildContext)
  .addNode("invokeLLM", invokeLLM)
  .addEdge(START, "retrieveVector")
  .addEdge("retrieveVector", "buildContext")
  .addEdge("buildContext", "invokeLLM")
  .addEdge("invokeLLM", END);

export const graph = workflow.compile();
