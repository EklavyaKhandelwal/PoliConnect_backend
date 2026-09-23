import  type { Request, Response } from "express";
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

  if (!inputType || !outputType) {
    return res.status(400).json({ error: "inputType and outputType are required" });
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

  if (inputType === "text") {
    if (!text) return res.status(400).json({ error: "text is required for inputType=text" });
    userContentText = text;
  } else if (inputType === "voice") {
    if (!req.file) return res.status(400).json({ error: "file is required for inputType=voice" });
    userContentText = await transcribeAudio(req.file.buffer, req.file.originalname, conversation.responseLanguage);
    userFileUrl = await uploadFile(req.file.buffer, `voice-in/${Date.now()}-${req.file.originalname}`, req.file.mimetype);
  } else if (inputType === "image") {
    if (!req.file) return res.status(400).json({ error: "file is required for inputType=image" });
    userContentText = await describeImage(req.file.buffer, req.file.mimetype);
    userFileUrl = await uploadFile(req.file.buffer, `image-in/${Date.now()}-${req.file.originalname}`, req.file.mimetype);
  } else {
    return res.status(400).json({ error: "Invalid inputType" });
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


  const { replyText, languageUsed, sources, sourceLabel } = await generateReply({
    conversationId: conversation._id,
    userInputText: userContentText,
    responseLanguage: conversation.responseLanguage,
    languageOverrideRequested: languageOverride ?? null,
  });
  let followUpQuestions: string[] = [];
  try {
    followUpQuestions = await generateFollowUpQuestions(userContentText, replyText, languageUsed);
  } catch (error) {
    console.error("Failed to generate follow-up questions:", error);
  }


  let replyFileUrl: string | null = null;
  if (outputType === "voice") {
    try {
      replyFileUrl = await generateSpeech(replyText, languageUsed);
    } catch (error) {
      console.error("Failed to generate voice answer; returning text answer:", error);
    }
  } else if (outputType === "image") {
    replyFileUrl = await generateImage(replyText);
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

export async function transcribeMessage(req: Request, res: Response) {
 if (!req.file) return res.status(400).json({ error: "file is required" });

 const language = (req.body.responseLanguage || "en") as Language;
 const transcript = await transcribeAudio(
   req.file.buffer,
   req.file.originalname,
   language,
 );

 if (!transcript.trim()) {
   return res.status(422).json({ error: "No speech was detected in the recording" });
 }

 res.json({ transcript: transcript.trim() });
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
  const fileUrl = await generateSpeech(message.contentText, language);
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

  const contentText = await translateText(message.contentText, language);
  res.json({ contentText, language });
}