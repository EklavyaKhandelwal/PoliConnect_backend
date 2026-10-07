import type { ProviderName } from "../../../types/common.types.js";
import type { ILLMProvider } from "../../../types/llmprovider.types.js";
import { AiServiceError } from "../aiReliability.service.js";
import { GroqProvider } from "./grok.provider.js";


export function getLLMProvider(): ILLMProvider {
  const providerName = (process.env.LLM_PROVIDER || "groq") as ProviderName;

  switch (providerName) {
    case "groq":
    default:
      if (!process.env.GROQ_API_KEY) {
        throw new AiServiceError(
          "The AI service is temporarily unavailable. Please try again.",
          503,
          "AI_NOT_CONFIGURED",
        );
      }
      return new GroqProvider();
  }
}