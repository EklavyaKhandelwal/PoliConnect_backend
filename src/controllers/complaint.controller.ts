import { randomInt, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import {
  COMPLAINT_CATEGORIES,
  ComplaintModel,
  type ComplaintCategory,
  type ComplaintStatus,
} from "../models/complaint.model";
import { deleteFile, uploadFile } from "../services/storage/storage.service";
import { resumeSlaDeadline } from "../services/complaintSla.service";

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const isDuplicateComplaintNumber = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === 11000 &&
  "keyPattern" in error &&
  typeof error.keyPattern === "object" &&
  error.keyPattern !== null &&
  "complaintNumber" in error.keyPattern;

const isDuplicateIdempotencyKey = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === 11000 &&
  "keyPattern" in error &&
  typeof error.keyPattern === "object" &&
  error.keyPattern !== null &&
  "idempotencyKey" in error.keyPattern;

const findExistingIdempotentComplaint = (
  userId: Types.ObjectId | null,
  guestId: string | null,
  idempotencyKey: string,
) => ComplaintModel.findOne({
  ...(userId ? { userId } : { guestId }),
  idempotencyKey,
})
  .select("complaintNumber status createdAt")
  .lean()
  .exec();

export const createComplaint = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const files = Array.isArray(req.files) ? req.files : [];
  const uploadedPaths: string[] = [];

  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "Complaint service is unavailable. Please try again shortly." });
      return;
    }

    const category = req.body.category as ComplaintCategory;
    const details = typeof req.body.details === "string" ? req.body.details.trim() : "";
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const phone = typeof req.body.phone === "string" ? req.body.phone.replace(/\D/g, "") : "";
    const area = typeof req.body.area === "string" ? req.body.area.trim() : "";
    const idempotencyKey =
      typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey : undefined;
    if (
      idempotencyKey &&
      !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(idempotencyKey)
    ) {
      res.status(400).json({ error: "The complaint submission key is invalid." });
      return;
    }
    if (req.body.privateName !== "true" && req.body.privateName !== "false") {
      res.status(400).json({ error: "Choose a valid name privacy setting." });
      return;
    }
    const privateName = req.body.privateName === "true";
    const latitude = req.body.latitude === undefined || req.body.latitude === ""
      ? undefined
      : Number(req.body.latitude);
    const longitude = req.body.longitude === undefined || req.body.longitude === ""
      ? undefined
      : Number(req.body.longitude);

    if (!COMPLAINT_CATEGORIES.includes(category)) {
      res.status(400).json({ error: "Choose a valid complaint category." });
      return;
    }
    if (!details || details.length > 2000) {
      res.status(400).json({ error: "Complaint details are required and must not exceed 2000 characters." });
      return;
    }
    if (name.length > 100 || area.length > 150) {
      res.status(400).json({ error: "Name or location exceeds the allowed length." });
      return;
    }
    if (phone.length !== 10) {
      res.status(400).json({ error: "Enter a valid contact phone number with exactly 10 digits." });
      return;
    }
    const hasCoordinates = latitude !== undefined && longitude !== undefined;
    const hasArea = area.length > 0;
    if (
      (latitude === undefined) !== (longitude === undefined) ||
      (hasCoordinates && (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) ||
      (!hasCoordinates && !hasArea)
    ) {
      res.status(400).json({ error: "Provide a valid map location or area." });
      return;
    }

    const userId = req.session.userId ? new Types.ObjectId(req.session.userId) : null;
    const guestId = userId ? null : req.session.guestId;
    if (idempotencyKey) {
      const existingComplaint = await findExistingIdempotentComplaint(
        userId,
        guestId,
        idempotencyKey,
      );
      if (existingComplaint) {
        res.status(200).json({ success: true, complaint: existingComplaint });
        return;
      }
    }

    const photoUrls: string[] = [];
    for (const file of files) {
      const extension = imageExtensions[file.mimetype];
      if (!extension) {
        res.status(400).json({ error: "Only supported image files can be attached." });
        return;
      }
      const storagePath = `complaints/${randomUUID()}.${extension}`;
      const photoUrl = await uploadFile(file.buffer, storagePath, file.mimetype);
      uploadedPaths.push(storagePath);
      photoUrls.push(photoUrl);
    }

    let complaint;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const complaintNumber = `JHS-${new Date().getFullYear()}-${randomInt(1000, 10000)}`;
      try {
        complaint = await ComplaintModel.create({
          complaintNumber,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          category,
          details,
          photos: photoUrls,
          location: {
            ...(hasCoordinates ? { latitude, longitude } : {}),
            ...(hasArea ? { area } : {}),
          },
          contact: { name, phone, privateName },
          status: "received",
          statusHistory: [{ status: "received" }],
          activityHistory: [{ type: "registered" }],
          userId,
          guestId,
        });
        break;
      } catch (error) {
        if (idempotencyKey && isDuplicateIdempotencyKey(error)) {
          complaint = await findExistingIdempotentComplaint(
            userId,
            guestId,
            idempotencyKey,
          ) ?? undefined;
          if (!complaint) throw error;
          await Promise.all(
            uploadedPaths.map((path) => deleteFile(path)),
          );
          break;
        }
        if (!isDuplicateComplaintNumber(error) || attempt === 4) throw error;
      }
    }

    if (!complaint) throw new Error("Could not allocate a unique complaint number.");
    res.status(201).json({
      success: true,
      complaint: {
        complaintNumber: complaint.complaintNumber,
        status: complaint.status,
        createdAt: complaint.createdAt,
      },
    });
  } catch (error) {
    await Promise.all(
      uploadedPaths.map((path) =>
        deleteFile(path).catch((cleanupError: unknown) => {
          console.error("Failed to remove an unassociated complaint photo:", cleanupError);
        }),
      ),
    );
    next(error);
  }
};

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Complaint service is unavailable. Please try again shortly." });
  return false;
};

export const serializeComplaint = (complaint: {
  complaintNumber: string;
  category: ComplaintCategory;
  details: string;
  photos: string[];
  location: { latitude?: number; longitude?: number; area?: string };
  status: ComplaintStatus;
  statusHistory?: Array<{
    status: ComplaintStatus;
    message?: string;
    updatedBy?: string;
    photos?: string[];
    createdAt: Date;
  }>;
  assignedDepartmentId?: {
    _id: Types.ObjectId;
    name: string;
    code: string;
  } | Types.ObjectId | null;
  assignedOfficerId?: {
    _id: Types.ObjectId;
    name: string;
    title: string;
  } | Types.ObjectId | null;
  slaDeadline?: Date | null;
  slaPausedAt?: Date | null;
  activityHistory?: Array<{
    type: string;
    status?: ComplaintStatus;
    message?: string;
    updatedBy?: string;
    createdAt: Date;
  }>;
  publicMessages?: Array<{
    sender: "admin" | "citizen";
    senderName?: string;
    message: string;
    photos: string[];
    requiresResponse: boolean;
    readAt?: Date | null;
    createdAt: Date;
  }>;
  citizenFeedback?: {
    confirmation: "resolved" | "not_resolved";
    rating?: number;
    tags: string[];
    comment: string;
    submittedAt: Date;
    adminReadAt?: Date | null;
    isHighlighted?: boolean;
    adminReplies?: Array<{ message: string; repliedBy: string; createdAt: Date }>;
  };
  createdAt?: Date;
  updatedAt?: Date;
}) => ({
  complaintNumber: complaint.complaintNumber,
  category: complaint.category,
  details: complaint.details,
  photos: complaint.photos,
  location: complaint.location,
  status: complaint.status,
  statusHistory: complaint.statusHistory?.length
    ? complaint.statusHistory
    : [
        {
          status: "received" as const,
          createdAt: complaint.createdAt ?? new Date(),
        },
        ...(complaint.status === "received"
          ? []
          : [{
              status: complaint.status,
              createdAt: complaint.updatedAt ?? complaint.createdAt ?? new Date(),
            }]),
      ],
  assignedDepartment: complaint.assignedDepartmentId && !(complaint.assignedDepartmentId instanceof Types.ObjectId)
    ? {
        id: complaint.assignedDepartmentId._id.toString(),
        name: complaint.assignedDepartmentId.name,
        code: complaint.assignedDepartmentId.code,
      }
    : null,
  assignedOfficer: complaint.assignedOfficerId && !(complaint.assignedOfficerId instanceof Types.ObjectId)
    ? {
        id: complaint.assignedOfficerId._id.toString(),
        name: complaint.assignedOfficerId.name,
        title: complaint.assignedOfficerId.title,
      }
    : null,
  slaDeadline: complaint.slaDeadline?.toISOString() ?? null,
  slaPausedAt: complaint.slaPausedAt?.toISOString() ?? null,
  activityHistory: complaint.activityHistory?.length
    ? complaint.activityHistory
    : complaint.statusHistory?.map((update) => ({
        type: update.status === "received" ? "registered" : "status_changed",
        status: update.status,
        message: update.message,
        updatedBy: update.updatedBy,
        createdAt: update.createdAt,
      })) ?? [],
  publicMessages: complaint.publicMessages ?? [],
  citizenFeedback: complaint.citizenFeedback?.confirmation
    ? {
        confirmation: complaint.citizenFeedback.confirmation,
        rating: complaint.citizenFeedback.rating,
        tags: complaint.citizenFeedback.tags,
        comment: complaint.citizenFeedback.comment,
        submittedAt: complaint.citizenFeedback.submittedAt,
        adminReadAt: complaint.citizenFeedback.adminReadAt ?? null,
        isHighlighted: Boolean(complaint.citizenFeedback.isHighlighted),
        adminReplies: (complaint.citizenFeedback.adminReplies ?? []).map((reply) => ({
          message: reply.message,
          repliedBy: reply.repliedBy,
          createdAt: reply.createdAt.toISOString(),
        })),
      }
    : null,
  createdAt: complaint.createdAt,
  updatedAt: complaint.updatedAt,
});

export const listComplaints = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    if (!req.session.userId && !req.session.guestId) {
      res.status(401).json({ error: "A valid session is required to view complaints." });
      return;
    }

    const query = ComplaintModel.find();
    if (req.session.userId) query.where("userId", new Types.ObjectId(req.session.userId));
    else query.where("guestId", req.session.guestId);
    const complaints = await query.sort({ createdAt: -1 }).exec();
    res.json({ success: true, complaints: complaints.map(serializeComplaint) });
  } catch (error) {
    next(error);
  }
};

export const getComplaint = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const complaintNumber = req.params.complaintNumber;
    if (!complaintNumber) {
      res.status(400).json({ error: "A complaint number is required." });
      return;
    }
    const query = ComplaintModel.findOne().where("complaintNumber", complaintNumber);
    if (req.session.userId) query.where("userId", new Types.ObjectId(req.session.userId));
    else query.where("guestId", req.session.guestId);
    const complaint = await query
      .populate("assignedDepartmentId", "name code")
      .populate("assignedOfficerId", "name title")
      .exec();
    if (!complaint) {
      res.status(404).json({ error: "Complaint not found." });
      return;
    }
    const viewedAt = new Date();
    let hasUnreadAdminMessages = false;
    for (const message of complaint.publicMessages) {
      if (message.sender === "admin" && !message.readAt) {
        message.readAt = viewedAt;
        hasUnreadAdminMessages = true;
      }
    }
    if (hasUnreadAdminMessages) {
      await ComplaintModel.updateOne(
        { _id: complaint._id },
        { $set: { "publicMessages.$[message].readAt": viewedAt } },
        { arrayFilters: [{ "message.sender": "admin", "message.readAt": null }] },
      ).exec();
    }
    res.json({ success: true, complaint: serializeComplaint(complaint) });
  } catch (error) {
    next(error);
  }
};

export const sendComplaintMessage = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const files = Array.isArray(req.files) ? req.files : [];
  const uploadedPaths: string[] = [];
  try {
    if (!isDatabaseReady(res)) return;
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if ((!message && files.length === 0) || message.length > 1000) {
      res.status(400).json({ error: "Write a message of up to 1000 characters." });
      return;
    }
    if (!req.session.userId && !req.session.guestId) {
      res.status(401).json({ error: "A valid session is required to reply to a complaint." });
      return;
    }
    const query = ComplaintModel.findOne().where("complaintNumber", req.params.complaintNumber);
    if (req.session.userId) query.where("userId", new Types.ObjectId(req.session.userId));
    else query.where("guestId", req.session.guestId);
    const complaint = await query.exec();
    if (!complaint) {
      res.status(404).json({ error: "Complaint not found." });
      return;
    }
    if (complaint.status === "resolved" || complaint.status === "rejected") {
      res.status(409).json({ error: "This complaint is closed and cannot receive new messages." });
      return;
    }

    const photoUrls: string[] = [];
    for (const file of files) {
      const extension = imageExtensions[file.mimetype];
      if (!extension) {
        res.status(400).json({ error: "Only supported image files can be attached." });
        return;
      }
      const storagePath = `complaints/${randomUUID()}.${extension}`;
      photoUrls.push(await uploadFile(file.buffer, storagePath, file.mimetype));
      uploadedPaths.push(storagePath);
    }

    const wasWaiting = complaint.status === "waiting_for_citizen";
    const now = new Date();
    complaint.publicMessages.push({
      sender: "citizen",
      message,
      photos: photoUrls,
      requiresResponse: false,
      createdAt: now,
    });
    if (wasWaiting) {
      if (complaint.slaDeadline && complaint.slaPausedAt) {
        complaint.slaDeadline = resumeSlaDeadline(complaint.slaDeadline, complaint.slaPausedAt, now);
      }
      complaint.slaPausedAt = null;
      complaint.status = "in_progress";
      complaint.statusHistory.push({
        status: "in_progress",
        message: "The citizen replied to the requested information.",
        createdAt: now,
      });
    }
    complaint.activityHistory.push({
      type: "citizen_reply",
      status: complaint.status,
      createdAt: now,
    });
    await complaint.save();
    await complaint.populate("assignedDepartmentId", "name code");
    await complaint.populate("assignedOfficerId", "name title");
    res.json({ success: true, complaint: serializeComplaint(complaint) });
  } catch (error) {
    await Promise.all(
      uploadedPaths.map((path) =>
        deleteFile(path).catch((cleanupError: unknown) => {
          console.error("Failed to remove an unassociated complaint reply photo:", cleanupError);
        }),
      ),
    );
    next(error);
  }
};

const FEEDBACK_TAGS = new Set(["quick", "polite", "complete", "faster"]);

export const submitComplaintFeedback = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const complaintNumber = req.params.complaintNumber;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Provide complaint feedback as a JSON object." });
      return;
    }
    const { confirmation, rating, tags, comment } = req.body as Record<string, unknown>;
    if (confirmation !== "resolved" && confirmation !== "not_resolved") {
      res.status(400).json({ error: "Choose whether the complaint has been resolved." });
      return;
    }
    if (
      rating !== undefined &&
      (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5)
    ) {
      res.status(400).json({ error: "Rating must be a whole number from 1 to 5." });
      return;
    }
    if (
      tags !== undefined &&
      (!Array.isArray(tags) || tags.length > FEEDBACK_TAGS.size ||
        tags.some((tag) => typeof tag !== "string" || !FEEDBACK_TAGS.has(tag)) ||
        new Set(tags).size !== tags.length)
    ) {
      res.status(400).json({ error: "Feedback contains an unsupported selection." });
      return;
    }
    if (comment !== undefined && (typeof comment !== "string" || comment.trim().length > 1000)) {
      res.status(400).json({ error: "Feedback comment must not exceed 1000 characters." });
      return;
    }
    const query = ComplaintModel.findOne().where("complaintNumber", complaintNumber);
    if (req.session.userId) query.where("userId", new Types.ObjectId(req.session.userId));
    else query.where("guestId", req.session.guestId);
    const complaint = await query.exec();
    if (!complaint) {
      res.status(404).json({ error: "Complaint not found." });
      return;
    }
    if (complaint.status !== "resolved") {
      res.status(409).json({ error: "You can confirm resolution after the complaint is marked resolved." });
      return;
    }

    const submittedAt = new Date();
    complaint.citizenFeedback = {
      confirmation,
      ...(rating === undefined ? {} : { rating }),
      tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
      comment: typeof comment === "string" ? comment.trim() : "",
      submittedAt,
      adminReadAt: null,
      adminReadBy: null,
      isHighlighted: false,
      highlightedAt: null,
      highlightedBy: null,
      adminReplies: [],
    };
    if (confirmation === "not_resolved") {
      if (complaint.slaDeadline && complaint.slaPausedAt) {
        complaint.slaDeadline = resumeSlaDeadline(
          complaint.slaDeadline,
          complaint.slaPausedAt,
          submittedAt,
        );
      }
      complaint.slaPausedAt = null;
      complaint.status = "in_progress";
      complaint.statusHistory.push({
        status: "in_progress",
        message: "The citizen reported that the issue is not resolved.",
        createdAt: submittedAt,
      });
      complaint.activityHistory.push({
        type: "citizen_reopened",
        status: "in_progress",
        ...(comment && typeof comment === "string" ? { message: comment.trim() } : {}),
        createdAt: submittedAt,
      });
    }
    await complaint.save();
    await complaint.populate("assignedDepartmentId", "name code");
    await complaint.populate("assignedOfficerId", "name title");
    res.json({ success: true, complaint: serializeComplaint(complaint) });
  } catch (error) {
    next(error);
  }
};
