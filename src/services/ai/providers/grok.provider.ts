import Groq from "groq-sdk";
import type { ILLMProvider, LLMGenerateInput, LLMGenerateOutput } from "../../../types/llmprovider.types.js";



export class GroqProvider implements ILLMProvider {
  private client: Groq;
  private model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  constructor() {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async generate(input: LLMGenerateInput): Promise<LLMGenerateOutput> {
    const { systemPrompt, history, userMessage, maxTokens } = input;

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: userMessage },
      ],
      reasoning_effort: "low",
        max_tokens: maxTokens ?? 300,
    });

    const text = completion.choices[0]?.message?.content ?? "";
    return { text, raw: completion };
  }


  
}