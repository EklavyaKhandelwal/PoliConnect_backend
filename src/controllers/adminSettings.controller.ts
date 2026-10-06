import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { COMPLAINT_CATEGORIES, type ComplaintActivityType, type ComplaintCategory } from "../models/complaint.model";
import {
  AdminSettingsModel,
  DEFAULT_ADMIN_SETTINGS,
  type AdminNotificationPreferences,
  type IAdminSettingsProfile,
} from "../models/adminSettings.model";

const notificationTypes: ComplaintActivityType[] = [
  "registered",
  "assigned",
  "status_changed",
  "resolved",
  "rejected",
  "citizen_reply",
  "citizen_reopened",
];

const databaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Admin settings are unavailable. Please try again shortly." });
  return false;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const isText = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" && value.trim().length <= maxLength;

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]) =>
  expected.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => expected.includes(key));

export const getAdminSettings = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!databaseReady(res)) return;
    const settings = await AdminSettingsModel.findOne({ scope: "global" }).lean().exec();
    res.json({ settings: settings ?? DEFAULT_ADMIN_SETTINGS });
  } catch (error) {
    next(error);
  }
};

export const updateAdminSettings = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!databaseReady(res)) return;
    const body = asRecord(req.body);
    const profile = asRecord(body?.profile);
    const slaWorkingDays = asRecord(body?.slaWorkingDays);
    const notifications = asRecord(body?.notifications);
    const profileKeys = ["organizationName", "officeName", "address", "contactEmail", "contactPhone"] as const;

    if (!body || !profile || !slaWorkingDays || !notifications ||
      !exactKeys(profile, profileKeys) ||
      !exactKeys(slaWorkingDays, COMPLAINT_CATEGORIES) ||
      !exactKeys(notifications, notificationTypes)) {
      res.status(400).json({ error: "Provide a complete, valid admin settings object." });
      return;
    }

    const profileLimits: Record<keyof IAdminSettingsProfile, number> = {
      organizationName: 100,
      officeName: 100,
      address: 250,
      contactEmail: 254,
      contactPhone: 30,
    };
    const cleanProfile = {} as IAdminSettingsProfile;
    for (const key of profileKeys) {
      const value = profile[key];
      if (!isText(value, profileLimits[key])) {
        res.status(400).json({ error: `The ${key} field is invalid or too long.` });
        return;
      }
      cleanProfile[key] = value.trim();
    }
    if (cleanProfile.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanProfile.contactEmail)) {
      res.status(400).json({ error: "Provide a valid contact email address." });
      return;
    }

    const cleanSlaWorkingDays = {} as Record<ComplaintCategory, number>;
    for (const category of COMPLAINT_CATEGORIES) {
      const days = slaWorkingDays[category];
      if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 60) {
        res.status(400).json({ error: "SLA targets must be whole numbers from 1 to 60 working days." });
        return;
      }
      cleanSlaWorkingDays[category] = days;
    }

    const cleanNotifications = {} as AdminNotificationPreferences;
    for (const type of notificationTypes) {
      const enabled = notifications[type];
      if (typeof enabled !== "boolean") {
        res.status(400).json({ error: "Notification preferences must be enabled or disabled." });
        return;
      }
      cleanNotifications[type] = enabled;
    }

    const settings = await AdminSettingsModel.findOneAndUpdate(
      { scope: "global" },
      { $set: { profile: cleanProfile, slaWorkingDays: cleanSlaWorkingDays, notifications: cleanNotifications } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean().exec();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
};
