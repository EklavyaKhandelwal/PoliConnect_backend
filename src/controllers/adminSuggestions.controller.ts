import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import {
  SuggestionModel,
  SUGGESTION_TYPES,
  type ISuggestion,
  type SuggestionDocument,
  type SuggestionType,
} from "../models/suggestion.model";
import { UserModel } from "../models/user.model";
import { ComplaintModel, type IComplaint } from "../models/complaint.model";

const PAGE_SIZE = 20;
const MAX_PAGE = 1_000_000;
const FEEDBACK_TAGS = ["quick", "polite", "complete", "faster"] as const;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseStringQuery = (value: unknown, maxLength: number): string | null => {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > maxLength) return null;
  return value.trim();
};

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Citizen input service is unavailable. Please try again shortly." });
  return false;
};

const serializeSuggestion = (
  suggestion: ISuggestion & { _id: mongoose.Types.ObjectId },
  citizenName: string | null,
) => ({
  referenceNumber: suggestion.referenceNumber,
  type: suggestion.type,
  message: suggestion.message,
  keepNamePrivate: suggestion.keepNamePrivate,
  citizenName: suggestion.keepNamePrivate ? null : citizenName,
  status: suggestion.status ?? "received",
  isHighlighted: Boolean(suggestion.isHighlighted),
  adminReplies: (suggestion.adminReplies ?? []).map((reply) => ({
    message: reply.message,
    repliedBy: reply.repliedBy,
    createdAt: reply.createdAt.toISOString(),
  })),
  readAt: suggestion.readAt?.toISOString() ?? null,
  readBy: suggestion.readBy ?? null,
  highlightedAt: suggestion.highlightedAt?.toISOString() ?? null,
  highlightedBy: suggestion.highlightedBy ?? null,
  createdAt: suggestion.createdAt?.toISOString() ?? null,
});

export const listAdminSuggestions = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const typeRaw = parseStringQuery(req.query.type, 24);
    const statusRaw = parseStringQuery(req.query.status, 16);
    const search = parseStringQuery(req.query.search, 100);
    const pageRaw = parseStringQuery(req.query.page, 8);
    const type = typeRaw || "all";
    const status = statusRaw || "all";
    const pageValue = pageRaw || "1";
    if (
      typeRaw === null ||
      (type !== "all" && !SUGGESTION_TYPES.includes(type as SuggestionType)) ||
      statusRaw === null ||
      (status !== "all" && status !== "received" && status !== "read") ||
      search === null ||
      pageRaw === null ||
      !/^\d+$/.test(pageValue) ||
      Number(pageValue) < 1 ||
      Number(pageValue) > MAX_PAGE
    ) {
      res.status(400).json({ error: "Suggestion filters are invalid." });
      return;
    }

    const filters: mongoose.QueryFilter<ISuggestion> = {};
    if (type !== "all") filters.type = type as SuggestionType;
    if (status !== "all") filters.status = status;
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      filters.$or = [{ referenceNumber: expression }, { message: expression }];
    }
    const page = Number(pageValue);
    const [total, allCount, unreadCount, typeCounts, records] = await Promise.all([
      SuggestionModel.countDocuments(filters).exec(),
      SuggestionModel.countDocuments().exec(),
      SuggestionModel.countDocuments({ status: "received" }).exec(),
      Promise.all(SUGGESTION_TYPES.map((suggestionType) =>
        SuggestionModel.countDocuments({ type: suggestionType }).exec(),
      )),
      SuggestionModel.find(filters)
        .select("referenceNumber type message keepNamePrivate status readAt readBy isHighlighted highlightedAt highlightedBy adminReplies userId createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
    ]);

    const visibleUserIds = records
      .filter((record) => !record.keepNamePrivate && record.userId)
      .map((record) => record.userId);
    const users = visibleUserIds.length
      ? await UserModel.find({ _id: { $in: visibleUserIds } }).select("name").lean().exec()
      : [];
    const userNames = new Map(users.map((user) => [user._id.toString(), user.name?.trim() || null]));

    res.json({
      suggestions: records.map((record) => serializeSuggestion(
        record as ISuggestion & { _id: mongoose.Types.ObjectId },
        record.userId ? userNames.get(record.userId.toString()) ?? null : null,
      )),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      counts: {
        all: allCount,
        unread: unreadCount,
        ...Object.fromEntries(SUGGESTION_TYPES.map((suggestionType, index) => [
          suggestionType,
          typeCounts[index] ?? 0,
        ])),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminSuggestion = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Provide a valid suggestion action." });
      return;
    }
    const { action } = req.body as { action?: unknown };
    const suggestion: SuggestionDocument | null = await SuggestionModel.findOne()
      .where("referenceNumber", req.params.referenceNumber)
      .exec();
    if (!suggestion) {
      res.status(404).json({ error: "Suggestion not found." });
      return;
    }
    const now = new Date();
    const actor = req.admin?.name || req.admin?.email || "Admin";
    suggestion.adminReplies ??= [];

    if (action === "read") {
      suggestion.status = "read";
      suggestion.readAt = now;
      suggestion.readBy = actor;
    } else if (action === "unread") {
      suggestion.status = "received";
      suggestion.readAt = null;
      suggestion.readBy = null;
    } else if (action === "highlight") {
      const enabled = (req.body as { enabled?: unknown }).enabled;
      if (typeof enabled !== "boolean") {
        res.status(400).json({ error: "Choose whether the suggestion should be highlighted." });
        return;
      }
      suggestion.isHighlighted = enabled;
      suggestion.highlightedAt = enabled ? now : null;
      suggestion.highlightedBy = enabled ? actor : null;
    } else if (action === "reply") {
      const message = (req.body as { message?: unknown }).message;
      if (typeof message !== "string" || !message.trim() || message.trim().length > 1000) {
        res.status(400).json({ error: "Write a reply of up to 1000 characters." });
        return;
      }
      suggestion.adminReplies.push({ message: message.trim(), repliedBy: actor, createdAt: now });
    } else {
      res.status(400).json({ error: "Choose a supported suggestion action." });
      return;
    }

    await suggestion.save();
    let citizenName: string | null = null;
    if (!suggestion.keepNamePrivate && suggestion.userId) {
      const user = await UserModel.findById(suggestion.userId).select("name").lean().exec();
      citizenName = user?.name?.trim() || null;
    }
    res.json({
      success: true,
      suggestion: serializeSuggestion(
        suggestion as ISuggestion & { _id: mongoose.Types.ObjectId },
        citizenName,
      ),
    });
  } catch (error) {
    next(error);
  }
};

export const listAdminComplaintFeedback = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const search = parseStringQuery(req.query.search, 100);
    const pageRaw = parseStringQuery(req.query.page, 8);
    const pageValue = pageRaw || "1";
    if (
      search === null ||
      pageRaw === null ||
      !/^\d+$/.test(pageValue) ||
      Number(pageValue) < 1 ||
      Number(pageValue) > MAX_PAGE
    ) {
      res.status(400).json({ error: "Feedback filters are invalid." });
      return;
    }

    const filters: mongoose.QueryFilter<IComplaint> = {
      "citizenFeedback.confirmation": { $in: ["resolved", "not_resolved"] },
    };
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      filters.$or = [
        { complaintNumber: expression },
        { details: expression },
        { category: expression },
        { "citizenFeedback.comment": expression },
      ];
    }
    const page = Number(pageValue);
    const [total, averageResult, records] = await Promise.all([
      ComplaintModel.countDocuments(filters).exec(),
      ComplaintModel.aggregate([
        { $match: filters },
        { $match: { "citizenFeedback.rating": { $type: "number" } } },
        { $group: { _id: null, averageRating: { $avg: "$citizenFeedback.rating" }, ratingCount: { $sum: 1 } } },
      ]).exec(),
      ComplaintModel.find(filters)
        .select("complaintNumber category status details citizenFeedback")
        .sort({ "citizenFeedback.submittedAt": -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
    ]);

    res.json({
      feedback: records.map((complaint) => ({
        complaintNumber: complaint.complaintNumber,
        category: complaint.category,
        complaintDetails: complaint.details,
        status: complaint.status,
        confirmation: complaint.citizenFeedback?.confirmation ?? "resolved",
        rating: complaint.citizenFeedback?.rating ?? null,
        tags: (complaint.citizenFeedback?.tags ?? []).filter(
          (tag): tag is (typeof FEEDBACK_TAGS)[number] =>
            typeof tag === "string" && FEEDBACK_TAGS.includes(tag as (typeof FEEDBACK_TAGS)[number]),
        ),
        comment: complaint.citizenFeedback?.comment ?? "",
        submittedAt: complaint.citizenFeedback?.submittedAt?.toISOString() ?? null,
        isRead: Boolean(complaint.citizenFeedback?.adminReadAt),
        readAt: complaint.citizenFeedback?.adminReadAt?.toISOString() ?? null,
        readBy: complaint.citizenFeedback?.adminReadBy ?? null,
        isHighlighted: Boolean(complaint.citizenFeedback?.isHighlighted),
        adminReplies: (complaint.citizenFeedback?.adminReplies ?? []).map((reply) => ({
          message: reply.message,
          repliedBy: reply.repliedBy,
          createdAt: reply.createdAt.toISOString(),
        })),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      summary: {
        averageRating: averageResult[0]?.averageRating
          ? Math.round(averageResult[0].averageRating * 10) / 10
          : 0,
        ratingCount: averageResult[0]?.ratingCount ?? 0,
        total,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminComplaintFeedback = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Provide a valid feedback action." });
      return;
    }
    const complaint = await ComplaintModel.findOne()
      .where("complaintNumber", req.params.complaintNumber)
      .exec();
    if (
      !complaint?.citizenFeedback ||
      !["resolved", "not_resolved"].includes(complaint.citizenFeedback.confirmation)
    ) {
      res.status(404).json({ error: "Complaint feedback not found." });
      return;
    }
    const feedback = complaint.citizenFeedback;
    feedback.adminReplies ??= [];
    const action = (req.body as { action?: unknown }).action;
    const actor = req.admin?.name || req.admin?.email || "Admin";
    const now = new Date();

    if (action === "read" || action === "unread") {
      feedback.adminReadAt = action === "read" ? now : null;
      feedback.adminReadBy = action === "read" ? actor : null;
    } else if (action === "highlight") {
      const enabled = (req.body as { enabled?: unknown }).enabled;
      if (typeof enabled !== "boolean") {
        res.status(400).json({ error: "Choose whether feedback should be highlighted." });
        return;
      }
      feedback.isHighlighted = enabled;
      feedback.highlightedAt = enabled ? now : null;
      feedback.highlightedBy = enabled ? actor : null;
    } else if (action === "reply") {
      const message = (req.body as { message?: unknown }).message;
      if (typeof message !== "string" || !message.trim() || message.trim().length > 1000) {
        res.status(400).json({ error: "Write a reply of up to 1000 characters." });
        return;
      }
      feedback.adminReplies.push({ message: message.trim(), repliedBy: actor, createdAt: now });
    } else {
      res.status(400).json({ error: "Choose a supported feedback action." });
      return;
    }

    await complaint.save();
    res.json({
      success: true,
      feedback: {
        complaintNumber: complaint.complaintNumber,
        isRead: Boolean(feedback.adminReadAt),
        readAt: feedback.adminReadAt?.toISOString() ?? null,
        readBy: feedback.adminReadBy ?? null,
        isHighlighted: Boolean(feedback.isHighlighted),
        adminReplies: feedback.adminReplies.map((reply) => ({
          message: reply.message,
          repliedBy: reply.repliedBy,
          createdAt: reply.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};
