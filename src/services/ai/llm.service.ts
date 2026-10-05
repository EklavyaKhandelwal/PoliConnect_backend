import { Types } from "mongoose";
import { prompts } from "../../prompts/prompts";
import { messageRepository } from "../../repositories/message.repository";
import { ComplaintModel } from "../../models/complaint.model";
import type { ContextMessage, Language } from "../../types/common.types";
import { getLLMProvider } from "./providers/providerFactory";
import { getSourceLabel, needsWebSearch, searchWeb, type WebSearchSource } from "./webSearch.service";





interface GenerateOptions {
  conversationId: Types.ObjectId;
  userInputText: string; 
  responseLanguage: Language;
  languageOverrideRequested?: Language | null;
  userId: string | null;
  guestId: string | null;
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

  const {
    conversationId,
    userInputText,
    responseLanguage,
    languageOverrideRequested,
    userId,
    guestId,
  } = options;

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
  const history = await buildContextWindow(conversationId);
  const complaintTopicPattern =
    /\b(complaint|complaints|status|track|tracking|filed|report|issue|reference|JHS-\d{4}|road|water|electricity|streetlight|drain)\b|शिकायत|स्थिति|तक्रार|तक्रारी|स्थिती|क्रमांक|अर्ज|सड़क|पानी|बिजली/iu;
  const complaintContextRequested =
    complaintTopicPattern.test(userInputText) ||
    history.slice(-6).some((message) => complaintTopicPattern.test(message.content));
  let complaintContext = "";
  if (complaintContextRequested) {
    const complaintQuery = ComplaintModel.find(
      userId
        ? { userId: new Types.ObjectId(userId) }
        : guestId
          ? { guestId }
          : { _id: { $exists: false } },
    )
      .sort({ createdAt: -1 })
      .limit(10)
      .select("complaintNumber category details location status statusHistory createdAt")
      .lean();
    const complaints = await complaintQuery.exec();
    const complaintData = complaints.map((complaint) => ({
      complaintNumber: complaint.complaintNumber,
      category: complaint.category,
      details: complaint.details.slice(0, 300),
      area: complaint.location.area ?? "",
      status: complaint.status,
      createdAt: complaint.createdAt,
      latestUpdate: complaint.statusHistory.at(-1)?.message ?? "",
    }));
    complaintContext =
      `\n\nCITIZEN'S OWN COMPLAINT RECORDS (private, verified app data):\n${JSON.stringify(complaintData)}\n` +
      "Use these records as the only source for the citizen's complaint numbers and current complaint statuses. " +
      "Never invent a complaint, number, status, location, or update. If there are multiple possible matches, ask which complaint they mean. " +
      "If no matching record exists, say you could not find it and ask them to verify the complaint number. Never disclose private contact details.";
  }
  const systemPrompt =
    prompts.citizenAssistanceSystemPrompt(effectiveLanguage) + searchContext + complaintContext;

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