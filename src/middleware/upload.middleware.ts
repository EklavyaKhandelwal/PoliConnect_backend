import multer from "multer";
import type { Request } from "express";

const storage = multer.memoryStorage();
const imageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
const audioMimeTypes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/x-m4a",
]);

const isSupportedAiUpload = (req: Request, mimeType: string): boolean => {
  const mime = mimeType.toLowerCase().split(";")[0] ?? "";
  if (req.path.endsWith("/transcribe") || req.body?.inputType === "voice") {
    return audioMimeTypes.has(mime);
  }
  return req.body?.inputType === "image" && imageMimeTypes.has(mime);
};

export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!isSupportedAiUpload(req, file.mimetype)) {
      const error = new Error("Unsupported AI upload type.");
      Object.assign(error, { status: 400, code: "UNSUPPORTED_AI_UPLOAD" });
      callback(error);
      return;
    }
    callback(null, true);
  },
});