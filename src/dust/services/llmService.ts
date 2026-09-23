import type { LLMProvider } from "../llm/LLMProvider";
import { GroqProvider } from "../llm/GroqProvider";

const llmProvider: LLMProvider = new GroqProvider();

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export const generateResponse = async (
  message: string,
  language: string = "hi",
  history: ChatHistoryMessage[] = []
): Promise<string> => {
  return llmProvider.generateResponse(
    message,
    language,
    history
  );
};