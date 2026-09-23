import type { ProviderName } from "../../../types/common.types.js";
import type { ILLMProvider } from "../../../types/llmprovider.types.js";
import { GroqProvider } from "./grok.provider.js";


export function getLLMProvider(): ILLMProvider {
  const providerName = (process.env.LLM_PROVIDER || "groq") as ProviderName;

  switch (providerName) {
    case "groq":
      return new GroqProvider();
    default:
      return new GroqProvider();
  }
}