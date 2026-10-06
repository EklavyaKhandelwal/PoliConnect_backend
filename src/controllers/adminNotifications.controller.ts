import type { NextFunction, Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { AdminNotificationStateModel } from "../models/adminNotificationState.model";
import { ComplaintModel, type ComplaintActivityType } from "../models/complaint.model";

const PAGE_SIZE = 20;
const activityTypes = new Set<ComplaintActivityType>([
  "registered",
  "assigned",
  "status_changed",
  "resolved",
  "rejected",
  "citizen_reply",
  "citizen_reopened",
]);

interface NotificationCursor {
  createdAt: Date;
  id: string;
}

interface NotificationActivityRecord {
  id: string;
  complaintNumber: string;
  category: string;
  type: ComplaintActivityType;
  status?: string;
  message?: string;
  updatedBy?: string;
  createdAt: Date;
  isRead: boolean;
}

const parseCursor = (value: unknown): NotificationCursor | null | false => {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || !("createdAt" in decoded) || !("id" in decoded)) return false;
    const cursor = decoded as { createdAt: unknown; id: unknown };
    const createdAt = typeof cursor.createdAt === "string" ? new Date(cursor.createdAt) : new Date(NaN);
    if (!Number.isFinite(createdAt.getTime()) || typeof cursor.id !== "string" || !cursor.id) return false;
    return { createdAt, id: cursor.id };
  } catch {
    return false;
  }
};

const encodeCursor = (activity: { createdAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ createdAt: activity.createdAt.toISOString(), id: activity.id })).toString("base64url");

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Notifications are unavailable. Please try again shortly." });
  return false;
};

export const getAdminNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    if (!req.admin?.userId) {
      res.status(401).json({ error: "Admin sign-in is required." });
      return;
    }

    const filter = req.query.filter ?? "all";
    if (filter !== "all" && filter !== "unread") {
      res.status(400).json({ error: "Choose the all or unread notification filter." });
      return;
    }
    const requestedTypes = req.query.types;
    const types = requestedTypes === undefined
      ? [...activityTypes]
      : typeof requestedTypes === "string"
        ? requestedTypes.split(",").filter(Boolean)
        : [];
    if (types.some((type) => !activityTypes.has(type as ComplaintActivityType))) {
      res.status(400).json({ error: "The notification event filter is invalid." });
      return;
    }
    const typeFilterStage = types.length
      ? [{ $match: { type: { $in: types } } }]
      : [{ $match: { _id: "__no_notification_types_enabled__" } }];
    const cursor = parseCursor(req.query.cursor);
    if (cursor === false) {
      res.status(400).json({ error: "The notification page cursor is invalid." });
      return;
    }

    const state = await AdminNotificationStateModel.findOne({
      adminId: new Types.ObjectId(req.admin.userId),
    }).select("readIds readThroughAt").lean().exec();
    const readIds = state?.readIds ?? [];
    const readThroughAt = state?.readThroughAt ?? new Date(0);
    const identityStages = [
      {
        $project: {
          _id: 0,
          id: { $ifNull: [{ $toString: "$activityHistory._id" }, null] },
          legacyId: {
            $concat: [
              "$complaintNumber",
              ":",
              "$activityHistory.type",
              ":",
              {
                $dateToString: {
                  date: "$activityHistory.createdAt",
                  format: "%Y-%m-%dT%H:%M:%S.%LZ",
                  timezone: "UTC",
                },
              },
            ],
          },
          complaintNumber: 1,
          category: 1,
          type: "$activityHistory.type",
          status: "$activityHistory.status",
          message: "$activityHistory.message",
          updatedBy: "$activityHistory.updatedBy",
          createdAt: "$activityHistory.createdAt",
        },
      },
      {
        $addFields: {
          id: { $ifNull: ["$id", "$legacyId"] },
          isRead: {
            $or: [
              { $lte: ["$createdAt", readThroughAt] },
              { $in: ["$id", readIds] },
              { $in: ["$legacyId", readIds] },
            ],
          },
        },
      },
    ];

    const [result] = await ComplaintModel.aggregate([
        { $match: { "activityHistory.createdAt": { $type: "date" } } },
        { $unwind: "$activityHistory" },
        { $match: { "activityHistory.createdAt": { $type: "date" } } },
        ...identityStages,
        ...typeFilterStage,
        {
          $facet: {
            counts: [
              {
                $group: {
                  _id: null,
                  totalCount: { $sum: 1 },
                  unreadCount: { $sum: { $cond: ["$isRead", 0, 1] } },
                },
              },
              { $project: { _id: 0, totalCount: 1, unreadCount: 1 } },
            ],
            activities: [
              ...(filter === "unread" ? [{ $match: { isRead: false } }] : []),
              ...(cursor
                ? [{
                    $match: {
                      $or: [
                        { createdAt: { $lt: cursor.createdAt } },
                        { createdAt: cursor.createdAt, id: { $lt: cursor.id } },
                      ],
                    },
                  }]
                : []),
              { $sort: { createdAt: -1, id: -1 } },
              { $limit: PAGE_SIZE + 1 },
            ],
          },
        },
      ]).exec();

    const counts = result?.counts ?? [];
    const activities = result?.activities ?? [];
    const hasMore = activities.length > PAGE_SIZE;
    const page = hasMore ? activities.slice(0, PAGE_SIZE) : activities;
    const lastItem = page.at(-1);
    res.json({
      activities: page.map((activity: NotificationActivityRecord) => ({
        id: activity.id,
        complaintNumber: activity.complaintNumber,
        category: activity.category,
        type: activity.type,
        status: activity.status ?? null,
        message: activity.message ?? null,
        updatedBy: activity.updatedBy ?? null,
        createdAt: activity.createdAt.toISOString(),
        isRead: activity.isRead,
      })),
      counts: {
        total: counts[0]?.totalCount ?? 0,
        unread: counts[0]?.unreadCount ?? 0,
      },
      nextCursor: hasMore && lastItem ? encodeCursor(lastItem) : null,
    });
  } catch (error) {
    next(error);
  }
};
