import type { NextFunction, Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { AdminNotificationStateModel } from "../models/adminNotificationState.model";
import type { ComplaintActivityType } from "../models/complaint.model";

const eventTypes = new Set<ComplaintActivityType>([
  "registered",
  "assigned",
  "status_changed",
  "resolved",
  "rejected",
  "citizen_reply",
  "citizen_reopened",
]);

const readState = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Notification state is unavailable. Please try again shortly." });
  return false;
};

const isNotificationId = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 200) return false;
  if (/^[\da-f]{24}$/i.test(value)) return true;
  const firstSeparator = value.indexOf(":");
  const secondSeparator = value.indexOf(":", firstSeparator + 1);
  if (firstSeparator < 1 || secondSeparator <= firstSeparator + 1) return false;
  const complaintNumber = value.slice(0, firstSeparator);
  const eventType = value.slice(firstSeparator + 1, secondSeparator);
  const createdAt = value.slice(secondSeparator + 1);
  return complaintNumber.length <= 100 &&
    eventTypes.has(eventType as ComplaintActivityType) &&
    Number.isFinite(Date.parse(createdAt));
};

export const getAdminNotificationState = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!readState(res)) return;
    if (!req.admin?.userId) {
      res.status(401).json({ error: "Admin sign-in is required." });
      return;
    }
    const state = await AdminNotificationStateModel.findOne({
      adminId: new Types.ObjectId(req.admin.userId),
    }).select("readIds readThroughAt").lean().exec();
    res.json({ readIds: state?.readIds ?? [], readThroughAt: state?.readThroughAt ?? null });
  } catch (error) {
    next(error);
  }
};

export const markAdminNotificationsRead = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!readState(res)) return;
    if (!req.admin?.userId) {
      res.status(401).json({ error: "Admin sign-in is required." });
      return;
    }
    const adminId = new Types.ObjectId(req.admin.userId);
    if (req.body?.markAll === true) {
      await AdminNotificationStateModel.updateOne(
        { adminId },
        {
          $set: { readThroughAt: new Date(), readIds: [] },
          $setOnInsert: { adminId },
        },
        { upsert: true },
      ).exec();
      res.json({ success: true });
      return;
    }

    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every(isNotificationId)) {
      res.status(400).json({ error: "Provide between 1 and 100 valid notification IDs." });
      return;
    }
    await AdminNotificationStateModel.updateOne(
      { adminId },
      {
        $addToSet: { readIds: { $each: Array.from(new Set(ids)) } },
        $setOnInsert: { adminId },
      },
      { upsert: true },
    ).exec();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
