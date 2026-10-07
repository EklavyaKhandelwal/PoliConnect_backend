import type { NextFunction, Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { CitizenNotificationStateModel } from "../models/citizenNotificationState.model";
import { ComplaintModel, type ComplaintActivityType } from "../models/complaint.model";

const PAGE_SIZE = 30;
const citizenActivityTypes: ComplaintActivityType[] = [
  "registered",
  "assigned",
  "status_changed",
  "resolved",
  "rejected",
];

interface CitizenNotification {
  id: string;
  complaintNumber: string;
  category: string;
  type: string;
  status: string | null;
  message: string | null;
  createdAt: Date;
  isRead: boolean;
}

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Notifications are unavailable. Please try again shortly." });
  return false;
};

const getRecipientKey = (req: Request): string | null => {
  if (req.session.userId) return `user:${req.session.userId}`;
  if (req.session.guestId) return `guest:${req.session.guestId}`;
  return null;
};

const isNotificationId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 150 &&
  /^activity:[\da-f]{24}$/i.test(value);

const notificationPipeline = (
  recipientFilter: { userId: Types.ObjectId } | { guestId: string },
  readIds: string[],
  readThroughAt: Date,
  filter: "all" | "unread",
  page: number,
): mongoose.PipelineStage[] => [
  { $match: recipientFilter },
  {
    $project: {
      notifications: {
        $concatArrays: [
          {
            $map: {
              input: {
                $filter: {
                  input: { $ifNull: ["$activityHistory", []] },
                  as: "activity",
                  cond: { $in: ["$$activity.type", citizenActivityTypes] },
                },
              },
              as: "activity",
              in: {
                id: { $concat: ["activity:", { $toString: "$$activity._id" }] },
                complaintNumber: "$complaintNumber",
                category: "$category",
                type: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$$activity.type", "status_changed"] },
                        {
                          $gt: [
                            {
                              $size: {
                                $filter: {
                                  input: { $ifNull: ["$publicMessages", []] },
                                  as: "publicMessage",
                                  cond: {
                                    $and: [
                                      { $eq: ["$$publicMessage.sender", "admin"] },
                                      { $eq: ["$$publicMessage.createdAt", "$$activity.createdAt"] },
                                      { $eq: ["$$publicMessage.message", "$$activity.message"] },
                                    ],
                                  },
                                },
                              },
                            },
                            0,
                          ],
                        },
                      ],
                    },
                    "message",
                    "$$activity.type",
                  ],
                },
                status: { $ifNull: ["$$activity.status", null] },
                message: { $ifNull: ["$$activity.message", null] },
                createdAt: "$$activity.createdAt",
              },
            },
          },
        ],
      },
    },
  },
  { $unwind: "$notifications" },
  { $replaceRoot: { newRoot: "$notifications" } },
  {
    $addFields: {
      isRead: {
        $or: [
          { $lte: ["$createdAt", readThroughAt] },
          { $in: ["$id", readIds] },
        ],
      },
    },
  },
  { $sort: { createdAt: -1, id: -1 } },
  {
    $facet: {
      counts: [
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            unread: { $sum: { $cond: ["$isRead", 0, 1] } },
          },
        },
        { $project: { _id: 0, total: 1, unread: 1 } },
      ],
      items: [
        ...(filter === "unread" ? [{ $match: { isRead: false } }] : []),
        { $skip: (page - 1) * PAGE_SIZE },
        { $limit: PAGE_SIZE },
      ],
    },
  },
];

export const listCitizenNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const recipientKey = getRecipientKey(req);
    if (!recipientKey) {
      res.status(401).json({ error: "A valid session is required to view notifications." });
      return;
    }
    const filter = req.query.filter ?? "all";
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (
      (filter !== "all" && filter !== "unread") ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000
    ) {
      res.status(400).json({ error: "The notification filter or page is invalid." });
      return;
    }

    const state = await CitizenNotificationStateModel.findOne({ recipientKey })
      .select("readIds readThroughAt")
      .lean()
      .exec();
    const recipientFilter = req.session.userId
      ? { userId: new Types.ObjectId(req.session.userId) }
      : { guestId: req.session.guestId! };
    const [result] = await ComplaintModel.aggregate<{
      counts: Array<{ total: number; unread: number }>;
      items: CitizenNotification[];
    }>(notificationPipeline(
      recipientFilter,
      state?.readIds ?? [],
      state?.readThroughAt ?? new Date(0),
      filter,
      page,
    )).exec();

    const notifications = result?.items ?? [];
    res.json({
      notifications: notifications.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      counts: {
        total: result?.counts[0]?.total ?? 0,
        unread: result?.counts[0]?.unread ?? 0,
      },
      page,
      pageSize: PAGE_SIZE,
      hasMore: filter === "unread"
        ? page * PAGE_SIZE < (result?.counts[0]?.unread ?? 0)
        : page * PAGE_SIZE < (result?.counts[0]?.total ?? 0),
    });
  } catch (error) {
    next(error);
  }
};

export const markCitizenNotificationsRead = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const recipientKey = getRecipientKey(req);
    if (!recipientKey) {
      res.status(401).json({ error: "A valid session is required to update notifications." });
      return;
    }
    if (req.body?.markAll === true) {
      await CitizenNotificationStateModel.updateOne(
        { recipientKey },
        {
          $set: { readThroughAt: new Date(), readIds: [] },
          $setOnInsert: { recipientKey },
        },
        { upsert: true },
      ).exec();
      res.json({ success: true });
      return;
    }

    const ids: unknown = req.body?.ids;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      !ids.every(isNotificationId)
    ) {
      res.status(400).json({ error: "Provide between 1 and 100 valid notification IDs." });
      return;
    }
    await CitizenNotificationStateModel.updateOne(
      { recipientKey },
      {
        $addToSet: { readIds: { $each: Array.from(new Set(ids)) } },
        $setOnInsert: { recipientKey },
      },
      { upsert: true },
    ).exec();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
