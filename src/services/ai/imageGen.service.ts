
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
  });

  if (!res.ok) throw new Error(`generateImage failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const imageBuffer = Buffer.from(data.data[0].b64_json, "base64");
  return uploadFile(imageBuffer, `images/${Date.now()}.png`, "image/png");
}