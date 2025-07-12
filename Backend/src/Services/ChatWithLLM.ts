import { PromptTemplate } from "@langchain/core/prompts";
import { chatLLM } from "./initializeChatService";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { AgentState } from "./Memory";
import { HumanMessage, BaseMessage, AIMessage } from "@langchain/core/messages"; // Import AIMessage

export async function invokeLLM(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log("LangGraph Node: invokeLLM");
  if (!chatLLM) {
    throw new Error("Chat LLM not initialized.");
  }

  // The prompt template now defines the overall instruction for the LLM
  // It will be filled with context, chat history, and the current question.
  const mainPromptTemplate = PromptTemplate.fromTemplate(
    `
You are an AI assistant for MOSDAC (Meteorological & Oceanographic Satellite Data Archival Centre).
Answer the user's question based on the provided context and chat history.
If an image was provided, analyze it carefully in conjunction with the question and context.
If the context contains information relevant to the question, use it to provide the best possible answer.
If there is truly no relevant information, then say you cannot answer.
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

  try {
    console.log("Context for LLM: \n", state.context, "\n\n\n\n");

    // 1. Format the main prompt with current state variables
    const formattedPromptText = await mainPromptTemplate.format({
      question: state.question,
      context: state.context || "No context provided.",
      chat_history: state.chat_history || "No prior chat history.",
    });

    // 2. Prepare the messages array for the LLM
    const messages: BaseMessage[] = [];

    // Add previous chat history messages (ensure roles are correct, e.g., HumanMessage, AIMessage)
    if (state.chat_history && state.chat_history.length > 0) {
      // LangChain's BufferWindowMemory typically returns messages with correct types (HumanMessage, AIMessage)
      messages.push(...state.chat_history);
    }

    // 3. Construct the current turn's HumanMessage, combining formatted text and optional image
    const currentHumanMessageContent: (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[] = [
      { type: "text", text: formattedPromptText } // Use the formatted prompt text here
    ];

    if (state.imageData) {
      console.log("Attaching image data to LLM prompt.");
      currentHumanMessageContent.push({
        type: "image_url",
        image_url: { url: state.imageData },
      });
    }

    // Add the current user's turn (formatted prompt + optional image) to the messages
    messages.push(new HumanMessage({ content: currentHumanMessageContent }));


    // 4. Create a runnable sequence: LLM -> StringOutputParser
    // This correctly handles the BaseMessageChunk output from chatLLM.invoke()
    const chain = RunnableSequence.from([
      (input: { messages: BaseMessage[] }) => input.messages, // Pass the messages through
      chatLLM,
      new StringOutputParser(),
    ]);

    // 5. Invoke the chain with the constructed messages
    const llmResponse = await chain.invoke({ messages });

    console.log("LLM Response ==> ", llmResponse, "\n\n\n\n");

    console.log("LLM Response generated.");
    return { llm_response: llmResponse };
  } catch (e: any) {
    console.error(`Error invoking LLM: ${e.message || e}`);
    return {
      llm_response:
        "I apologize, but I encountered an error while generating a response.",
    };
  }
}

// handleSimpleResponse remains unchanged
export async function handleSimpleResponse(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log("LangGraph Node: handleSimpleResponse (LLM-driven)");
  const classification = state.llm_response;
  const userQuestion = state.question;

  if (!chatLLM) {
    console.warn("Chat LLM not initialized for simple response generation. Falling back to hardcoded.");
    let fallbackResponse: string;
    if (classification === "greeting") {
      fallbackResponse = "Hello there! How can I assist you with MOSDAC-related queries today?";
    } else if (classification === "other") {
      fallbackResponse = `I specialize in MOSDAC, satellite data, and space missions. Your question doesn't seem to be about that. Perhaps you could ask me something like "What is MOSDAC?" or "Tell me about ISRO's Chandrayaan mission?"`;
    } else {
      fallbackResponse = "I'm not sure how to respond to that. Please ask me about MOSDAC or space-related topics.";
    }
    return { llm_response: fallbackResponse };
  }

  let promptTemplate: PromptTemplate;

  if (classification === "greeting") {
    promptTemplate = PromptTemplate.fromTemplate(`
You are an AI assistant for MOSDAC. The user just greeted you.
Respond with a friendly greeting and offer to help with MOSDAC, satellite data, or space mission related queries.
Keep your response concise and welcoming.

User's greeting: {question}
Your response:
`);
  } else if (classification === "other") {
    promptTemplate = PromptTemplate.fromTemplate(`
You are an AI assistant for MOSDAC. The user's question is not related to MOSDAC, satellite data, or space missions.
Respond politely, stating that you specialize in MOSDAC and related topics. Gently nudge the user to ask a relevant question. You can be slightly playful or "roast" them very, very gently if it's completely off-topic, but always remain helpful and polite.

User's question: {question}
Your response:
`);
  } else {
    promptTemplate = PromptTemplate.fromTemplate(`
You are an AI assistant for MOSDAC. The user's question is: {question}.
I'm not sure how to categorize this, please provide a helpful default response.
Your response:
`);
  }

  const chain = RunnableSequence.from([
    promptTemplate,
    chatLLM,
    new StringOutputParser(),
  ]);

  try {
    const response = await chain.invoke({ question: userQuestion });
    console.log(`LLM-generated simple response for classification "${classification}": ${response}`);
    return { llm_response: response };
  } catch (e: any) {
    console.error(`Error generating simple response with LLM for classification "${classification}": ${e.message || e}`);
    return { llm_response: "I encountered an issue while trying to respond. Please try again or ask a MOSDAC-related question." };
  }
}