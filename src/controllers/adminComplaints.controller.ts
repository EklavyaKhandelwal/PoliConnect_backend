import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  ComplaintModel,
  type ComplaintCategory,
  type ComplaintStatus,
  type IComplaint,
} from "../models/complaint.model";
import { addWorkingDays } from "../services/complaintSla.service";

const PAGE_SIZE = 10;
const MAX_PAGE = 1_000_000;
const SLA_FILTERS = ["all", "overdue", "due_soon", "on_track", "no_deadline"] as const;
type SlaFilter = (typeof SLA_FILTERS)[number];
const STATUS_FILTERS = ["all", "overdue", ...COMPLAINT_STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseStringQuery = (
  value: unknown,
  maxLength: number,
): string | null => {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > maxLength) return null;
  return value.trim();
};

const isOneOf = <T extends readonly string[]>(value: string, options: T): value is T[number] =>
  options.includes(value);

const andFilters = (...parts: mongoose.QueryFilter<IComplaint>[]): mongoose.QueryFilter<IComplaint> => {
  const meaningful = parts.filter((part) => Object.keys(part).length > 0);
  return meaningful.length > 1 ? { $and: meaningful } : meaningful[0] ?? {};
};

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Complaint service is unavailable. Please try again shortly." });
  return false;
};

const slaQuery = (filter: SlaFilter, now: Date): mongoose.QueryFilter<IComplaint> => {
  const soonLimit = addWorkingDays(now, 2);
  switch (filter) {
    case "overdue":
      return {
        slaDeadline: { $lt: now },
        status: { $nin: ["resolved", "rejected", "waiting_for_citizen"] },
      };
    case "due_soon":
      return {
        slaDeadline: { $gte: now, $lte: soonLimit },
        status: { $nin: ["resolved", "rejected", "waiting_for_citizen"] },
      };
    case "on_track":
      return {
        slaDeadline: { $gt: soonLimit },
        status: { $nin: ["resolved", "rejected", "waiting_for_citizen"] },
      };
    case "no_deadline":
      return {
        $or: [{ slaDeadline: null }, { slaDeadline: { $exists: false } }],
      };
    default:
      return {};
  }
};

const serializedComplaint = (complaint: {
  _id: mongoose.Types.ObjectId;
  complaintNumber: string;
  category: ComplaintCategory;
  details: string;
  location: { area?: string };
  status: ComplaintStatus;
  contact: { name?: string; privateName: boolean };
  assignedDepartmentId?: unknown;
  slaDeadline?: Date | null;
  slaPausedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}) => {
  const assignedDepartment = complaint.assignedDepartmentId &&
    typeof complaint.assignedDepartmentId === "object" &&
    "_id" in complaint.assignedDepartmentId
    ? complaint.assignedDepartmentId as { _id: mongoose.Types.ObjectId; name: string; code: string }
    : null;
  return {
    id: complaint._id.toString(),
    complaintNumber: complaint.complaintNumber,
    category: complaint.category,
    details: complaint.details,
    location: { area: complaint.location.area ?? "" },
    status: complaint.status,
    citizenName: complaint.contact.privateName ? null : complaint.contact.name?.trim() || null,
    assignedDepartment: assignedDepartment
      ? { id: assignedDepartment._id.toString(), name: assignedDepartment.name, code: assignedDepartment.code }
      : null,
    slaDeadline: complaint.slaDeadline?.toISOString() ?? null,
    slaPausedAt: complaint.slaPausedAt?.toISOString() ?? null,
    createdAt: complaint.createdAt?.toISOString() ?? null,
    updatedAt: complaint.updatedAt?.toISOString() ?? null,
  };
};

export const listAdminComplaints = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;

    const statusRaw = parseStringQuery(req.query.status, 32);
    const categoryRaw = parseStringQuery(req.query.category, 32);
    const area = parseStringQuery(req.query.area, 150);
    const slaRaw = parseStringQuery(req.query.sla, 24);
    const search = parseStringQuery(req.query.search, 100);
    const sortRaw = parseStringQuery(req.query.sort, 20);
    const pageRaw = parseStringQuery(req.query.page, 8);
    const statusValue = statusRaw || "all";
    const categoryValue = categoryRaw || "all";
    const slaValue = slaRaw || "all";
    const sortValue = sortRaw || "newest";
    const pageValue = pageRaw || "1";

    if (
      statusRaw === null || categoryRaw === null || slaRaw === null || sortRaw === null || pageRaw === null ||
      !isOneOf(statusValue, STATUS_FILTERS) ||
      !categoryValue || (categoryValue !== "all" && !COMPLAINT_CATEGORIES.includes(categoryValue as ComplaintCategory)) ||
      area === null || slaValue === null || !isOneOf(slaValue, SLA_FILTERS) ||
      search === null ||
      !isOneOf(sortValue, ["newest", "oldest", "sla_asc", "sla_desc"] as const) ||
      !/^\d+$/.test(pageValue) ||
      Number(pageValue) < 1 ||
      Number(pageValue) > MAX_PAGE
    ) {
      res.status(400).json({ error: "Complaint filters are invalid. Check the selected status, category, location, SLA, sorting, and page." });
      return;
    }

    const now = new Date();
    const filters: mongoose.QueryFilter<IComplaint> = {};
    if (categoryValue !== "all") filters.category = categoryValue as ComplaintCategory;
    if (area) filters["location.area"] = area;
    if (search) {
      const expression = new RegExp(escapeRegex(search), "i");
      filters.$or = [
        { complaintNumber: expression },
        { details: expression },
        { "location.area": expression },
        {
          $and: [
            { "contact.privateName": { $ne: true } },
            { "contact.name": expression },
          ],
        },
      ];
    }
    const queryFilters = andFilters(filters, slaQuery(slaValue, now));

    const statusCountsPromise = Promise.all([
      ComplaintModel.countDocuments(queryFilters).exec(),
      ...COMPLAINT_STATUSES.map((status) =>
        ComplaintModel.countDocuments(andFilters(queryFilters, { status })).exec(),
      ),
    ]);
    const overdueCountPromise = ComplaintModel.countDocuments({
      ...andFilters(filters, slaQuery("overdue", now)),
    }).exec();
    const areasPromise = ComplaintModel.distinct("location.area", {
      "location.area": { $type: "string", $ne: "" },
    }).exec();

    let rowFilters: mongoose.QueryFilter<IComplaint> = queryFilters;
    if (statusValue === "overdue") {
      rowFilters = andFilters(filters, slaQuery("overdue", now));
    } else if (statusValue !== "all") {
      rowFilters = andFilters(queryFilters, { status: statusValue as ComplaintStatus });
    }

    const page = Number(pageValue);
    const sort = sortValue === "oldest"
      ? { createdAt: 1 as const, _id: 1 as const }
      : sortValue === "sla_asc"
        ? { slaDeadline: 1 as const, createdAt: -1 as const }
        : sortValue === "sla_desc"
          ? { slaDeadline: -1 as const, createdAt: -1 as const }
          : { createdAt: -1 as const, _id: -1 as const };
    const [total, statusCounts, overdueCount, areas, records] = await Promise.all([
      ComplaintModel.countDocuments(rowFilters).exec(),
      statusCountsPromise,
      overdueCountPromise,
      areasPromise,
      ComplaintModel.find(rowFilters)
        .select("complaintNumber category details location.area status contact.name contact.privateName assignedDepartmentId slaDeadline slaPausedAt createdAt updatedAt")
        .populate("assignedDepartmentId", "name code")
        .sort(sort)
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
    ]);

    const counts = Object.fromEntries(
      COMPLAINT_STATUSES.map((status, index) => [status, statusCounts[index + 1] ?? 0]),
    ) as Record<ComplaintStatus, number>;
    res.json({
      complaints: records.map(serializedComplaint),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      counts: { all: statusCounts[0], ...counts, overdue: overdueCount },
      areas: areas.filter((value): value is string => typeof value === "string" && value.length > 0).sort(),
    });
  } catch (error) {
    next(error);
  }
};
