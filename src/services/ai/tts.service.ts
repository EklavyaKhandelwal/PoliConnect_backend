import type { Language } from "../../types/common.types";
import { uploadFile } from "../storage/storage.service";
import { runAiOperation } from "./aiReliability.service";
import { generateOmnivoiceSpeech } from "./voiceClone/omnivoiceClient";

const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";
const GROQ_TTS_TERMS_URL =
  "https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english";

async function generateGroqSpeech(text: string): Promise<Buffer> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error("Configure GROQ_API_KEY");
  }

  const response = await fetch(GROQ_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english",
      voice: process.env.GROQ_TTS_VOICE || "troy",
      input: text,
      response_format: "wav",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const details = await response.text();
    if (details.includes("model_terms_required")) {
      throw new Error(
        `Groq TTS model terms have not been accepted. An organization admin must accept them at ${GROQ_TTS_TERMS_URL}`,
      );
    }
    const error = new Error("Speech generation provider request failed.");
    Object.assign(error, { status: response.status });
    throw error;
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function generateSpeech(text: string, _language: Language): Promise<string> {
  let audioBuffer: Buffer;

  try {
    audioBuffer = await runAiOperation(
      "primary-speech-provider",
      () => generateOmnivoiceSpeech(text),
      25_000,
    );
  } catch {
    console.warn("Primary speech provider failed; trying the configured fallback.");
    audioBuffer = await runAiOperation("fallback-speech-provider", () => generateGroqSpeech(text));
  }

  return uploadFile(audioBuffer, `audio/${Date.now()}.wav`, "audio/wav");
}