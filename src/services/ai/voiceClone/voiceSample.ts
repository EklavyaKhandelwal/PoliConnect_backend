import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOICE_SAMPLE_PATH = path.join(__dirname, "../../../assets/voice-sample.wav");

export function getVoiceSampleBuffer(): Buffer {
  return readFileSync(VOICE_SAMPLE_PATH);
}

export function getVoiceSampleTranscript(): string {
  const transcript = process.env.VOICE_SAMPLE_TRANSCRIPT;
  if (!transcript) {
    throw new Error("VOICE_SAMPLE_TRANSCRIPT is not configured in .env");
  }
  return transcript;
}