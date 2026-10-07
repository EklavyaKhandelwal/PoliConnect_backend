
import { prompts } from "../../prompts/prompts";
import { uploadFile } from "../storage/storage.service";


export async function generateImage(userText: string): Promise<string> {
  const prompt = prompts.imagePromptFromText(userText);

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const error = new Error("Image generation provider request failed.");
    Object.assign(error, { status: res.status });
    throw error;
  }

  const data = await res.json() as { data?: Array<{ b64_json?: string }> };
  const encodedImage = data.data?.[0]?.b64_json;
  if (!encodedImage) throw new Error("Image generation returned no image.");
  const imageBuffer = Buffer.from(encodedImage, "base64");
  return uploadFile(imageBuffer, `images/${Date.now()}.png`, "image/png");
}