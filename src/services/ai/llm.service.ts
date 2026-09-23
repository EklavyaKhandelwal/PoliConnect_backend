import type { Types } from "mongoose";
import { prompts } from "../../prompts/prompts";
import { messageRepository } from "../../repositories/message.repository";
import type { ContextMessage, Language } from "../../types/common.types";
import { getLLMProvider } from "./providers/providerFactory";
import { getSourceLabel, needsWebSearch, searchWeb, type WebSearchSource } from "./webSearch.service";





interface GenerateOptions {
  conversationId: Types.ObjectId;
  userInputText: string; 
  responseLanguage: Language;
  languageOverrideRequested?: Language | null;
}
 
interface GenerateResult {
  replyText: string;
  languageUsed: Language;
  sources: WebSearchSource[];
  sourceLabel: string;
}

function normalizeReply(text: string): string {
  const plainText = text
    .replace(/\*\*/g, "")
    .replace(/(^|\n)#{1,6}\s*/g, "$1")
    .trim();
  const completeText = plainText.slice(0, 700);
  const lastSentence = Math.max(
    completeText.lastIndexOf("।"),
    completeText.lastIndexOf("."),
    completeText.lastIndexOf("!"),
    completeText.lastIndexOf("?"),
  );
  const endsWithPunctuation = /[।.!?]$/.test(plainText);

  if (plainText.length <= 700 && endsWithPunctuation) return plainText;
  if (lastSentence > 120) return completeText.slice(0, lastSentence + 1).trim();
  return completeText.trim();
}







async function buildContextWindow(conversationId: Types.ObjectId): Promise<ContextMessage[]> {

  const recent = await messageRepository.findByContextWindow(conversationId);
  return recent.map((m) => ({ role: m.role, content: m.contentText }));
}


export async function generateReply(options: GenerateOptions): Promise<GenerateResult> {

  const { conversationId, userInputText, responseLanguage, languageOverrideRequested } = options;

  const effectiveLanguage = languageOverrideRequested ?? responseLanguage;
  const shouldSearch = needsWebSearch(userInputText);
  let sources: WebSearchSource[] = [];
  if (shouldSearch) {
    try {
      sources = await searchWeb(userInputText);
    } catch (error) {
      console.error("Web search failed; continuing without search results:", error);
    }
  }

  const searchContext = sources.length
    ? `\n\nCURRENT WEB SOURCES:\n${sources
        .map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\n${source.content.slice(0, 1400)}`)
        .join("\n\n")
        .slice(0, 5200)}\n\nUse these sources only for current facts. Do not invent facts not supported by them.`
    : "";
  const systemPrompt = prompts.citizenAssistanceSystemPrompt(effectiveLanguage) + searchContext;
  const history = await buildContextWindow(conversationId);

  const provider = getLLMProvider();
  const { text } = await provider.generate({
    systemPrompt,
    history,
    userMessage: userInputText,
  });

  return {
    replyText: normalizeReply(text),
    languageUsed: effectiveLanguage,
    sources,
    sourceLabel: getSourceLabel(sources),
  };
}

export async function translateText(text: string, language: Language): Promise<string> {
  const provider = getLLMProvider();
  const { text: translated } = await provider.generate({
    systemPrompt: `Translate the supplied civic assistant response into ${language}. Preserve the meaning, facts, formatting, and tone. Return only the translated response, without commentary.`,
    history: [],
    userMessage: text,
  });
  return translated;
}

const CASUAL_MESSAGE_PATTERN = /^(hi|hello|hey|thanks|thank you|okay|ok|goodbye|bye|नमस्ते|नमस्कार|धन्यवाद|ठीक है|अलविदा|हाय|थैंक यू)[!,.।\s]*$/iu;

export async function generateFollowUpQuestions(
  userMessage: string,
  replyText: string,
  language: Language,
): Promise<string[]> {
  if (CASUAL_MESSAGE_PATTERN.test(userMessage.trim())) return [];

  const provider = getLLMProvider();
  const { text } = await provider.generate({
    systemPrompt: `Generate exactly 3 short follow-up questions that the user can ask next about the civic-assistance answer.
Write every item as a direct user question, not as an instruction and not as a question asking the user to choose a category.
Keep them specific to the answer. If the answer has no meaningful civic topic, return [].
Return only a valid JSON array of strings, with no markdown or extra text. Use the requested language: ${language}.`,
    history: [],
    userMessage: `User's message:\n${userMessage}\n\nAssistant's answer:\n${replyText}`,
  });

  try {
    const parsed: unknown = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 3);
  } catch {
    console.error("Failed to parse generated follow-up questions:", text);
    return [];
  }
}