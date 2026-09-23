import type { Request, Response } from "express";
import { Types } from "mongoose";
import { conversationRepository } from "../repositories/conversation.repository";
import { messageRepository } from "../repositories/message.repository";
import type { Language } from "../types/common.types";

const parseConversationId = (conversationId: string | string[] | undefined): Types.ObjectId | null => {
  if (typeof conversationId !== "string") {
    return null;
  }

  if (!Types.ObjectId.isValid(conversationId)) {
    return null;
  }

  return new Types.ObjectId(conversationId);
};

export const getConversations = async (req: Request, res: Response): Promise<void> => {
  if (!req.session.userId) {
    res.json({ conversations: [] });
    return;
  }
  const conversations = await conversationRepository.findBySessionId(new Types.ObjectId(req.session.sessionId));
  const summaries = await Promise.all(
    conversations.map(async (conversation) => {
      const latestMessage = await messageRepository.findLatestByConversationId(conversation._id);
      return {
        ...conversation.toObject(),
        preview: latestMessage?.contentText ?? "",
        kind: latestMessage?.inputType === "voice" || latestMessage?.outputType === "voice" ? "voice" : "text",
      };
    }),
  );
  res.json({ conversations: summaries });
};

export const getConversation = async (req: Request, res: Response): Promise<void> => {
  const conversationObjectId = parseConversationId(req.params.conversationId);

  if (!conversationObjectId) {
    res.status(400).json({ error: "Invalid conversationId" });
    return;
  }

  const conversation = await conversationRepository.findByIdAndSessionId(
    conversationObjectId,
    new Types.ObjectId(req.session.sessionId)
  );

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json({ conversation });
};


export const updateConversation = async (req: Request, res: Response): Promise<void> => {
  const conversationObjectId = parseConversationId(req.params.conversationId);
  const { title, responseLanguage } = req.body as { title?: string; responseLanguage?: Language };

  if (!conversationObjectId) {
    res.status(400).json({ error: "Invalid conversationId" });
    return;
  }

  if (!title && !responseLanguage) {
    res.status(400).json({ error: "Provide at least one of: title, responseLanguage" });
    return;
  }

  const updated = await conversationRepository.updateByIdAndSessionId(
    conversationObjectId,
    new Types.ObjectId(req.session.sessionId),
    { ...(title && { title }), ...(responseLanguage && { responseLanguage }) }
  );

  if (!updated) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json({ conversation: updated });
};

/** DELETE /conversations/:conversationId — also removes all its messages */
export const deleteConversation = async (req: Request, res: Response): Promise<void> => {
  const conversationObjectId = parseConversationId(req.params.conversationId);

  if (!conversationObjectId) {
    res.status(400).json({ error: "Invalid conversationId" });
    return;
  }

  const deleted = await conversationRepository.deleteByIdAndSessionId(
    conversationObjectId,
    new Types.ObjectId(req.session.sessionId)
  );

  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await messageRepository.deleteByConversationId(conversationObjectId);

  res.json({ success: true });
};