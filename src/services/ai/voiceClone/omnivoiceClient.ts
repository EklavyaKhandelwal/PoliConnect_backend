import { Client } from "@gradio/client";
import { getVoiceSampleBuffer, getVoiceSampleTranscript } from "./voiceSample";

const OMNIVOICE_SPACE = "k2-fsa/OmniVoice";

let clientPromise: Promise<Client> | null = null;

function getClient(): Promise<Client> {
  if (!clientPromise) {
    const hfToken = process.env.HUGGINGFACE_TOKEN;
    clientPromise = Client.connect(
     OMNIVOICE_SPACE,
     hfToken ? { token: hfToken as `hf_${string}` } : undefined,
    );
    
  }
  return clientPromise;
}

export async function generateOmnivoiceSpeech(text: string): Promise<Buffer> {
  const client = await getClient();
  const refAudioBuffer = getVoiceSampleBuffer();
  const refText = getVoiceSampleTranscript();
  const refAudioBlob = new Blob([Uint8Array.from(refAudioBuffer)], { type: "audio/wav" });

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedDuration = Math.min(120, Math.max(5, Math.ceil(wordCount / 2.2) + 3));

  const result = await client.predict("/_clone_fn", {
    text,
    lang: "Auto",
    ref_aud: refAudioBlob,
    ref_text: refText,
    instruct: "",
    ns: 32,
    gs: 2.0,
    dn: true,
    sp: 1.0,
    du: estimatedDuration,
    pp: true,
    po: true,
  });

  const data = result.data as any;
  console.log("OmniVoice raw response:", JSON.stringify(data));

  const audioInfo = Array.isArray(data) ? data[0] : data;
  const audioUrl: string | undefined = audioInfo?.url ?? audioInfo?.path;

  if (!audioUrl) {
    throw new Error("OmniVoice returned no usable audio URL");
  }

  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(`Failed to download OmniVoice audio: ${audioResponse.status}`);
  }

  return Buffer.from(await audioResponse.arrayBuffer());
}