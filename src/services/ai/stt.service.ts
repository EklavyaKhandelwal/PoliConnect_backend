import type { Language } from "../../types/common.types";

const WHISPER_LANG_CODE: Record<Language, string> = {
  en: "en",
  hi: "hi",
  mr: "mr",
};

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  language: Language,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(audioBuffer)]), filename);
  formData.append("model", process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo");
  formData.append("language", WHISPER_LANG_CODE[language] || "en");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`transcribeAudio failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { text?: string };
  return data.text ?? "";
}
