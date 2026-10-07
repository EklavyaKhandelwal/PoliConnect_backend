import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import { messageRepository } from "../repositories/message.repository";
import { conversationRepository } from "../repositories/conversation.repository";
import { generateFollowUpQuestions, generateReply, translateText } from "../services/ai/llm.service";
import { transcribeAudio } from "../services/ai/stt.service";
import { generateSpeech } from "../services/ai/tts.service";
import { generateImage } from "../services/ai/imageGen.service";

import type { InputType, OutputType, Language } from "../types/common.types";
import { uploadFile } from "../services/storage/storage.service";
import { describeImage } from "../services/ai/describeImage.service";
import { runAiOperation } from "../services/ai/aiReliability.service";
import { randomUUID } from "node:crypto";

const safeFileExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
};



export async function sendMessage(req: Request, res: Response) {
  const conversationParam = req.params.conversationId;
  if (Array.isArray(conversationParam)) {
    return res.status(400).json({ error: "Invalid conversationId" });
  }

  const conversationId = conversationParam;
  const {
    inputType,
    outputType,
    text,
    languageOverride,
    responseLanguage: newConvLanguage,
  } = req.body as {
    inputType: InputType;
    outputType: OutputType;
    text?: string;
    languageOverride?: Language;
    responseLanguage?: Language;
  };

  if (!["text", "voice", "image"].includes(inputType) ||
    !["text", "voice", "image"].includes(outputType)) {
    return res.status(400).json({ error: "inputType and outputType are required" });
  }
  if (
    (newConvLanguage !== undefined && !["en", "hi", "mr"].includes(newConvLanguage)) ||
    (languageOverride !== undefined && !["en", "hi", "mr"].includes(languageOverride))
  ) {
    return res.status(400).json({ error: "Choose a supported response language." });
  }
  if (inputType === "text" && (typeof text !== "string" || !text.trim() || text.length > 4000)) {
    return res.status(400).json({ error: "Enter a message of up to 4000 characters." });
  }

  let conversation;

  const isNew = !conversationId || conversationId === "new";
  if (isNew) {
    conversation = await conversationRepository.create({
      sessionId: new Types.ObjectId(req.session.sessionId),
      responseLanguage: newConvLanguage || "en",
      ...(req.session.userId ? {} : { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
    });
  } else {
    if (!Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: "Invalid conversationId" });
    }
    conversation = await conversationRepository.findByIdAndSessionId(
      new Types.ObjectId(conversationId),
      new Types.ObjectId(req.session.sessionId),
    );
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  }

  let userContentText: string;
  let userFileUrl: string | null = null;
  let inputFile: Express.Multer.File | null = null;

  if (inputType === "text") {
    userContentText = text!.trim();
  } else if (inputType === "voice") {
    if (!req.file) return res.status(400).json({ error: "file is required for inputType=voice" });
    const file = req.file;
    userContentText = (await runAiOperation(
      "speech-transcription",
      () => transcribeAudio(file.buffer, file.originalname, conversation.responseLanguage),
    )).slice(0, 4000);
    inputFile = file;
  } else if (inputType === "image") {
    if (!req.file) return res.status(400).json({ error: "file is required for inputType=image" });
    const file = req.file;
    userContentText = (await runAiOperation(
      "image-analysis",
      () => describeImage(file.buffer, file.mimetype),
    )).slice(0, 4000);
    inputFile = file;
  } else {
    return res.status(400).json({ error: "Invalid inputType" });
  }

  const { replyText, languageUsed, sources, sourceLabel } = await generateReply({
    conversationId: conversation._id,
    userInputText: userContentText,
    responseLanguage: conversation.responseLanguage,
    languageOverrideRequested: languageOverride ?? null,
    userId: req.session.userId,
    guestId: req.session.guestId,
  });

  if (inputFile) {
    const mimeType = inputFile.mimetype.split(";")[0]?.toLowerCase() ?? "";
    const extension = safeFileExtensions[mimeType] ?? "upload";
    const folder = inputType === "image" ? "image-in" : "voice-in";
    userFileUrl = await uploadFile(
      inputFile.buffer,
      `${folder}/${randomUUID()}.${extension}`,
      inputFile.mimetype,
    );
  }
  await messageRepository.create({
    conversationId: conversation._id,
    role: "user",
    inputType,
    contentText: userContentText,
    fileUrl: userFileUrl,
    languageOverride: false,
    ...(req.session.userId ? {} : { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
  });
  let followUpQuestions: string[] = [];
  try {
    followUpQuestions = await runAiOperation(
      "follow-up-generation",
      () => generateFollowUpQuestions(userContentText, replyText, languageUsed),
    );
  } catch {
    console.warn("AI follow-up generation failed; returning the answer without suggestions.");
  }


  let replyFileUrl: string | null = null;
  if (outputType === "voice") {
    try {
      replyFileUrl = await runAiOperation(
        "speech-generation",
        () => generateSpeech(replyText, languageUsed),
        60_000,
      );
    } catch {
      console.warn("AI speech generation failed; returning the text answer.");
    }
  } else if (outputType === "image") {
    try {
      replyFileUrl = await runAiOperation("image-generation", () => generateImage(replyText));
    } catch {
      console.warn("AI image generation failed; returning the text answer.");
    }
  }

  const assistantMessage = await messageRepository.create({
    conversationId: conversation._id,
    role: "assistant",
    outputType,
    contentText: replyText,
    fileUrl: replyFileUrl,
    responseLanguage: languageUsed,
    languageOverride: Boolean(languageOverride),
    ...(req.session.userId ? {} : { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
  });

  await conversationRepository.updateById(conversation._id, {});

  res.status(201).json({
    conversationId: conversation._id,
    isNewConversation: isNew,
    message: assistantMessage,
    followUpQuestions,
    sources: sources.map(({ title, url }) => ({ title, url })),
    sourceLabel,
  });
}

export async function transcribeMessage(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.file) return res.status(400).json({ error: "file is required" });

  try {
    const language = (req.body.responseLanguage || "en") as Language;
    const transcript = await runAiOperation(
      "speech-transcription",
      () => transcribeAudio(req.file!.buffer, req.file!.originalname, language),
    );

    if (!transcript.trim()) {
      return res.status(422).json({ error: "No speech was detected in the recording" });
    }

    res.json({ transcript: transcript.trim() });
  } catch (error) {
    const failure = error as { name?: unknown; status?: unknown; code?: unknown };
    console.warn("[SpeechTranscription] operation failed:", {
      name: typeof failure.name === "string" ? failure.name : "UnknownError",
      status: typeof failure.status === "number" ? failure.status : undefined,
      code: typeof failure.code === "string" ? failure.code : undefined,
    });
    next(error);
  }
}

export async function getMessages(req: Request, res: Response) {
  const conversationParam = req.params.conversationId;
  if (Array.isArray(conversationParam) || !conversationParam) {
    return res.status(400).json({ error: "Invalid conversationId" });
  }

  const conversationId = conversationParam;
  if (!Types.ObjectId.isValid(conversationId)) {
    return res.status(400).json({ error: "Invalid conversationId" });
  }

  const conversation = await conversationRepository.findByIdAndSessionId(
    new Types.ObjectId(conversationId),
    new Types.ObjectId(req.session.sessionId),
  );
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });

  const messages = await messageRepository.findByConversationId(new Types.ObjectId(conversationId));
  res.json({ messages });
}

export async function deleteMessage(req: Request, res: Response) {
  const messageParam = req.params.messageId;
  if (Array.isArray(messageParam) || !messageParam) {
    return res.status(400).json({ error: "Invalid messageId" });
  }

  const messageId = messageParam;
  if (!Types.ObjectId.isValid(messageId)) {
    return res.status(400).json({ error: "Invalid messageId" });
  }

  const deleted = await messageRepository.deleteById(new Types.ObjectId(messageId));
  if (!deleted) return res.status(404).json({ error: "Message not found" });

  res.json({ success: true });
}

export async function speakMessage(req: Request, res: Response) {
  const messageParam = req.params.messageId;
  if (Array.isArray(messageParam) || !messageParam) {
    return res.status(400).json({ error: "Invalid messageId" });
  }
  if (!Types.ObjectId.isValid(messageParam)) {
    return res.status(400).json({ error: "Invalid messageId" });
  }

  const message = await messageRepository.findById(new Types.ObjectId(messageParam));
  if (!message) return res.status(404).json({ error: "Message not found" });

  if (message.fileUrl) {
    return res.json({ fileUrl: message.fileUrl });
  }

  const language = message.responseLanguage || "en";
  const fileUrl = await runAiOperation(
    "speech-generation",
    () => generateSpeech(message.contentText, language),
  );
  const updated = await messageRepository.updateById(message._id, { fileUrl });

  res.json({ fileUrl: updated?.fileUrl ?? fileUrl });
}

export async function translateMessage(req: Request, res: Response) {
  const messageParam = req.params.messageId;
  const language = req.body.language as Language;
  if (typeof messageParam !== "string" || !Types.ObjectId.isValid(messageParam)) {
    return res.status(400).json({ error: "Invalid messageId" });
  }
  if (!["en", "hi", "mr"].includes(language)) {
    return res.status(400).json({ error: "Unsupported language" });
  }

  const message = await messageRepository.findById(new Types.ObjectId(messageParam));
  if (!message || message.role !== "assistant") {
    return res.status(404).json({ error: "Assistant message not found" });
  }
  const conversation = await conversationRepository.findByIdAndSessionId(
    message.conversationId,
    new Types.ObjectId(req.session.sessionId),
  );
  if (!conversation) return res.status(404).json({ error: "Message not found" });

  const contentText = await runAiOperation(
    "translation",
    () => translateText(message.contentText, language),
  );
  res.json({ contentText, language });
}