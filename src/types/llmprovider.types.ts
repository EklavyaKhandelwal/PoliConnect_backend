import type { ContextMessage } from "./common.types";

export interface LLMGenerateInput {
  systemPrompt: string;
  history: ContextMessage[];
  userMessage: string;
  maxTokens?: number;
}

export interface LLMGenerateOutput {
  text: string;
  raw?: unknown; 
}


export interface ILLMProvider {
  generate(input: LLMGenerateInput): Promise<LLMGenerateOutput>;
}