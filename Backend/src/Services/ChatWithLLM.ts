import { PromptTemplate } from "@langchain/core/prompts";
import { chatLLM } from "./initializeChatService";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { AgentState } from "./Memory";

export async function invokeLLM(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log("LangGraph Node: invokeLLM");
  if (!chatLLM) {
    throw new Error("Chat LLM not initialized.");
  }

  const prompt = PromptTemplate.fromTemplate(
    `
You are an AI assistant for MOSDAC (Meteorological & Oceanographic Satellite Data Archival Centre).
Answer the user's question based on the provided context and chat history.
If the context contains information relevant to the question, use it to provide the best possible answer. 
If there is truly no relevant information, then say you cannot answer
Do not make up information.

Context:
{context}

Chat History:
{chat_history}

Question:
{question}

Provide a clear, concise, factual answer based on the above.
`
  );

  const chain = RunnableSequence.from([
    prompt,
    chatLLM,
    new StringOutputParser(),
  ]);

  try {
    // console.log("\n\n\n\n    question : ", state.context, "\n\n\n\n");

    const response = await chain.invoke({
      question: state.question,
      context: state.context || "No context provided.",
      chat_history: state.chat_history || "No prior chat history.",
    });

    console.log("\n\n\n\n LLM Response ==> ", response, "\n\n\n\n");

    console.log("LLM Response generated.");
    return { llm_response: response };
  } catch (e: any) {
    console.error(`Error invoking LLM: ${e.message || e}`);
    return {
      llm_response:
        "I apologize, but I encountered an error while generating a response.",
    };
  }
}
