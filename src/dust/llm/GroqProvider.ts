import Groq from "groq-sdk";
import type { LLMProvider } from "./LLMProvider";

export class GroqProvider implements LLMProvider {
  private client: Groq;

  constructor() {
    this.client = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  async generateResponse(
    message: string,
    language: string,
    history: {
      role: "user" | "assistant";
      content: string;
    }[]
  ): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: "openai/gpt-oss-120b",

      messages: [
        {
          role: "system",
          content: `You are a citizen assistance AI for India.

Your job is to help citizens understand problems, government services,
complaints, schemes and possible next steps.

LANGUAGE:
- hi = Hindi
- mr = Marathi

Always respond in the requested language.

RESPONSE STYLE:
- Be conversational and easy to understand.
- Keep responses concise and actionable.
- Prefer 3-5 clear steps.
- Avoid unnecessary explanations.
- Do not repeat the user's question.
- Use bullet points or numbered lists when useful.
- Ask for additional information only when necessary.

IMPORTANT:
- Never invent government schemes, phone numbers, addresses, URLs,
  officials or application procedures.
- If you are unsure, clearly say so.
- Do not claim that a complaint or application has been submitted.
- Do not provide fake contact details.

Use the conversation history to understand follow-up questions.
If the user says "वह", "वहां", "उसके लिए", "there", "that", etc.,
use the previous conversation to understand what they are referring to.`,
        },

        ...history,

        {
          role: "user",
          content: `Language: ${language}

Question:
${message}`,
        },
      ],

      reasoning_effort: "low",
    });

    return completion.choices[0]?.message?.content ?? "";
  }
}