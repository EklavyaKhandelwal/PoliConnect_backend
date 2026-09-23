export interface LLMProvider {
  generateResponse(
    message: string,
    language: string,
    history: {
      role: "user" | "assistant";
      content: string;
    }[]
  ): Promise<string>;
}