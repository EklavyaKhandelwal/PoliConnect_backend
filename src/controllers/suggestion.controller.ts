import { randomInt } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import {
  SuggestionModel,
  SUGGESTION_TYPES,
  type SuggestionDocument,
  type SuggestionType,
} from "../models/suggestion.model";

const createReferenceNumber = (type: SuggestionType) => {
  const prefix = type === "thanks" ? "THX" : type === "question" ? "QUE" : "SUG";
  return `${prefix}-${new Date().getFullYear()}-${randomInt(100000, 1000000)}`;
};

const isDuplicateReference = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === 11000 &&
  "keyPattern" in error &&
  typeof error.keyPattern === "object" &&
  error.keyPattern !== null &&
  "referenceNumber" in error.keyPattern;

export const listMySuggestions = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "Suggestion service is unavailable. Please try again shortly." });
      return;
    }
    if (!req.session.userId && !req.session.guestId) {
      res.status(401).json({ error: "A valid session is required to view suggestions." });
      return;
    }
    const filter = req.session.userId
      ? { userId: new Types.ObjectId(req.session.userId) }
      : { guestId: req.session.guestId };
    const suggestions = await SuggestionModel.find(filter).sort({ createdAt: -1, _id: -1 }).lean().exec();
    res.json({
      success: true,
      suggestions: suggestions.map((suggestion) => ({
        referenceNumber: suggestion.referenceNumber,
        type: suggestion.type,
        message: suggestion.message,
        status: suggestion.status,
        readAt: suggestion.readAt?.toISOString() ?? null,
        isHighlighted: Boolean(suggestion.isHighlighted),
        adminReplies: (suggestion.adminReplies ?? []).map((reply) => ({
          message: reply.message,
          repliedBy: reply.repliedBy,
          createdAt: reply.createdAt.toISOString(),
        })),
        createdAt: suggestion.createdAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const createSuggestion = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "Suggestion service is unavailable. Please try again shortly." });
      return;
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Provide a suggestion as a JSON object." });
      return;
    }

    const { type, message, keepNamePrivate } = req.body as {
      type?: unknown;
      message?: unknown;
      keepNamePrivate?: unknown;
    };
    if (typeof type !== "string" || !SUGGESTION_TYPES.includes(type as SuggestionType)) {
      res.status(400).json({ error: "Choose a valid suggestion type." });
      return;
    }
    if (typeof message !== "string" || !message.trim() || message.trim().length > 500) {
      res.status(400).json({ error: "Message is required and must not exceed 500 characters." });
      return;
    }
    if (typeof keepNamePrivate !== "boolean") {
      res.status(400).json({ error: "Choose a valid name privacy setting." });
      return;
    }
    if (!Types.ObjectId.isValid(req.session.sessionId)) {
      res.status(401).json({ error: "A valid session is required to send a suggestion." });
      return;
    }

    const userId = req.session.userId ? new Types.ObjectId(req.session.userId) : null;
    let suggestion: SuggestionDocument | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        suggestion = await SuggestionModel.create({
          referenceNumber: createReferenceNumber(type as SuggestionType),
          type: type as SuggestionType,
          message: message.trim(),
          keepNamePrivate,
          status: "received",
          sessionId: new Types.ObjectId(req.session.sessionId),
          userId,
          guestId: userId ? null : req.session.guestId,
        });
        break;
      } catch (error) {
        if (!isDuplicateReference(error) || attempt === 4) throw error;
      }
    }
    if (!suggestion) throw new Error("Could not allocate a unique suggestion reference.");
    if (!suggestion.createdAt) throw new Error("Suggestion was saved without a creation timestamp.");

    res.status(201).json({
      success: true,
      suggestion: {
        referenceNumber: suggestion.referenceNumber,
        type: suggestion.type,
        message: suggestion.message,
        keepNamePrivate: suggestion.keepNamePrivate,
        status: suggestion.status,
        createdAt: suggestion.createdAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};
