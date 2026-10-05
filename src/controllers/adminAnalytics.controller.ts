import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  ComplaintModel,
  type IComplaint,
} from "../models/complaint.model";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const CLOSED_STATUSES = ["resolved", "rejected"] as const;
const OPEN_STATUSES = COMPLAINT_STATUSES.filter(
  (status) => !CLOSED_STATUSES.includes(status as (typeof CLOSED_STATUSES)[number]),
);

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const dateAtTimeZoneMidnight = (date: Date, timeZone: string): Date => {
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const adjustment = target - represented;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  return new Date(candidate);
};

const periodKey = (date: Date, timeZone: string, bucket: "hour" | "day" | "month"): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(bucket === "hour" ? { hour: "2-digit", hourCycle: "h23" as const } : {}),
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const month = `${parts.year}-${parts.month}`;
  if (bucket === "month") return month;
  const day = `${month}-${parts.day}`;
  return bucket === "hour" ? `${day}T${parts.hour}` : day;
};

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Complaint service is unavailable. Please try again shortly." });
  return false;
};

export const getAdminOverview = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;

    const now = new Date();
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const defaultFrom = new Date(defaultTo.getTime() - 29 * DAY_MS);
    const from = req.query.from === undefined ? defaultFrom : parseDate(req.query.from);
    const to = req.query.to === undefined ? defaultTo : parseDate(req.query.to);

    if (
      !from ||
      !to ||
      from > to ||
      (to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS
    ) {
      res.status(400).json({ error: "Choose a valid date range of up to 366 days." });
      return;
    }

    const timeZone = typeof req.query.timeZone === "string" ? req.query.timeZone : "UTC";
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format(now);
    } catch {
      res.status(400).json({ error: "Choose a valid time zone." });
      return;
    }
    const requestedBucket = req.query.bucket;
    if (
      requestedBucket !== undefined &&
      requestedBucket !== "hour" &&
      requestedBucket !== "day" &&
      requestedBucket !== "month"
    ) {
      res.status(400).json({ error: "Choose an hourly, daily, or monthly trend bucket." });
      return;
    }
    const rangeDays = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
    const bucket = requestedBucket ?? (rangeDays === 1 ? "hour" : rangeDays > 90 ? "month" : "day");
    if (bucket === "hour" && rangeDays !== 1) {
      res.status(400).json({ error: "Hourly trends require a single-day date range." });
      return;
    }
    const fromLocal = dateAtTimeZoneMidnight(from, timeZone);
    const lastLocalDay = new Date(to);
    lastLocalDay.setUTCDate(lastLocalDay.getUTCDate() + 1);
    const toExclusive = dateAtTimeZoneMidnight(lastLocalDay, timeZone);
    const periodFilter: mongoose.QueryFilter<IComplaint> = {
      createdAt: { $gte: fromLocal, $lt: toExclusive },
    };
    const activeFilter: mongoose.QueryFilter<IComplaint> = {
      status: { $in: OPEN_STATUSES },
    };
    const overdueFilter: mongoose.QueryFilter<IComplaint> = {
      ...activeFilter,
      status: { $nin: [...CLOSED_STATUSES, "waiting_for_citizen"] },
      slaDeadline: { $lt: now },
      slaPausedAt: null,
    };
    const resolvedFilter: mongoose.QueryFilter<IComplaint> = {
      $or: [
        {
          statusHistory: {
            $elemMatch: {
              status: "resolved",
              createdAt: { $gte: fromLocal, $lt: toExclusive },
            },
          },
        },
        {
          status: "resolved",
          updatedAt: { $gte: fromLocal, $lt: toExclusive },
          $or: [
            { statusHistory: { $size: 0 } },
            { statusHistory: { $exists: false } },
          ],
        },
      ],
    };

    const trendFormat = bucket === "month"
      ? "%Y-%m"
      : bucket === "hour"
        ? "%Y-%m-%dT%H"
        : "%Y-%m-%d";
    const trendMatch = { createdAt: { $gte: fromLocal, $lt: toExclusive } };
    const [
      submitted,
      open,
      resolved,
      overdue,
      categories,
      statuses,
      trend,
      activity,
      recentComplaints,
    ] = await Promise.all([
      ComplaintModel.countDocuments(periodFilter).exec(),
      ComplaintModel.countDocuments(activeFilter).exec(),
      ComplaintModel.countDocuments(resolvedFilter).exec(),
      ComplaintModel.countDocuments(overdueFilter).exec(),
      ComplaintModel.aggregate([
        { $match: periodFilter },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]).exec(),
      ComplaintModel.aggregate([
        { $match: periodFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]).exec(),
      ComplaintModel.aggregate([
        { $match: trendMatch },
        {
          $group: {
            _id: { $dateToString: { format: trendFormat, date: "$createdAt", timezone: timeZone } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]).exec(),
      ComplaintModel.aggregate([
        { $match: { "activityHistory.createdAt": { $gte: fromLocal, $lt: toExclusive } } },
        { $unwind: "$activityHistory" },
        { $match: { "activityHistory.createdAt": { $gte: fromLocal, $lt: toExclusive } } },
        { $sort: { "activityHistory.createdAt": -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            complaintNumber: 1,
            category: 1,
            type: "$activityHistory.type",
            status: "$activityHistory.status",
            message: "$activityHistory.message",
            updatedBy: "$activityHistory.updatedBy",
            createdAt: "$activityHistory.createdAt",
          },
        },
      ]).exec(),
      ComplaintModel.find(periodFilter)
        .select("complaintNumber category details location.area status assignedDepartmentId slaDeadline slaPausedAt createdAt")
        .populate("assignedDepartmentId", "name code")
        .sort({ createdAt: -1, _id: -1 })
        .limit(5)
        .lean()
        .exec(),
    ]);

    const categoryCounts = Object.fromEntries(
      COMPLAINT_CATEGORIES.map((category) => [category, 0]),
    ) as Record<(typeof COMPLAINT_CATEGORIES)[number], number>;
    for (const item of categories as Array<{ _id: string; count: number }>) {
      if (Object.hasOwn(categoryCounts, item._id)) categoryCounts[item._id as keyof typeof categoryCounts] = item.count;
    }

    const statusCounts = Object.fromEntries(
      COMPLAINT_STATUSES.map((status) => [status, 0]),
    ) as Record<(typeof COMPLAINT_STATUSES)[number], number>;
    for (const item of statuses as Array<{ _id: string; count: number }>) {
      if (Object.hasOwn(statusCounts, item._id)) statusCounts[item._id as keyof typeof statusCounts] = item.count;
    }

    const assignedDepartment = (department: unknown) => {
      if (!department || typeof department !== "object" || !("_id" in department)) return null;
      const value = department as { _id: mongoose.Types.ObjectId; name: string; code: string };
      return { id: value._id.toString(), name: value.name, code: value.code };
    };

    const trendCounts = new Map(
      (trend as Array<{ _id: string; count: number }>).map(({ _id, count }) => [_id, count]),
    );
    const trendPoints: Array<{ period: string; count: number }> = [];
    if (bucket === "month") {
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      const finalMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
      while (cursor <= finalMonth) {
        const period = cursor.toISOString().slice(0, 7);
        trendPoints.push({ period, count: trendCounts.get(period) ?? 0 });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    } else if (bucket === "hour") {
      const seenHours = new Set<string>();
      for (let cursor = fromLocal.getTime(); cursor < toExclusive.getTime(); cursor += 60 * 60 * 1000) {
        const period = periodKey(new Date(cursor), timeZone, "hour");
        if (!seenHours.has(period)) {
          trendPoints.push({ period, count: trendCounts.get(period) ?? 0 });
          seenHours.add(period);
        }
      }
    } else {
      const cursor = new Date(from);
      while (cursor <= to) {
        const period = cursor.toISOString().slice(0, 10);
        trendPoints.push({ period, count: trendCounts.get(period) ?? 0 });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    res.json({
      range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      bucket,
      metrics: {
        submitted,
        open,
        resolved,
        overdue,
        resolutionRate: submitted === 0 ? 0 : Math.round((resolved / submitted) * 1000) / 10,
      },
      categoryBreakdown: COMPLAINT_CATEGORIES.map((category) => ({
        category,
        count: categoryCounts[category],
      })),
      statusBreakdown: COMPLAINT_STATUSES.map((status) => ({ status, count: statusCounts[status] })),
      trend: trendPoints,
      recentActivity: (activity as Array<{
        complaintNumber: string;
        category: string;
        type: string;
        status?: string;
        message?: string;
        updatedBy?: string;
        createdAt: Date;
      }>).map((item) => ({
        complaintNumber: item.complaintNumber,
        category: item.category,
        type: item.type,
        status: item.status ?? null,
        message: item.message ?? null,
        updatedBy: item.updatedBy ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      recentComplaints: recentComplaints.map((complaint) => ({
        complaintNumber: complaint.complaintNumber,
        category: complaint.category,
        details: complaint.details,
        area: complaint.location?.area ?? "",
        status: complaint.status,
        assignedDepartment: assignedDepartment(complaint.assignedDepartmentId),
        slaDeadline: complaint.slaDeadline?.toISOString() ?? null,
        slaPausedAt: complaint.slaPausedAt?.toISOString() ?? null,
        createdAt: complaint.createdAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
};
