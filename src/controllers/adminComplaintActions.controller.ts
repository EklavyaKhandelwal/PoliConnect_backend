import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { ComplaintModel, type ComplaintDocument, type ComplaintStatus } from "../models/complaint.model";
import { DepartmentModel } from "../models/department.model";
import { OfficerModel } from "../models/officer.model";
import { AdminSettingsModel, DEFAULT_SLA_WORKING_DAYS } from "../models/adminSettings.model";
import { addWorkingDays, resumeSlaDeadline } from "../services/complaintSla.service";
import { deleteFile, uploadFile } from "../services/storage/storage.service";

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Complaint service is unavailable. Please try again shortly." });
  return false;
};

const textField = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string" || value.length > maxLength) return null;
  return value.trim();
};

const isClosed = (status: ComplaintStatus) => status === "resolved" || status === "rejected";

const findComplaint = (complaintNumber: string) =>
  ComplaintModel.findOne().where("complaintNumber", complaintNumber).exec();

const serializeAdminComplaint = async (complaint: ComplaintDocument) => {
  const [department, officer] = await Promise.all([
    complaint.assignedDepartmentId
      ? DepartmentModel.findById(complaint.assignedDepartmentId).select("name code").lean().exec()
      : null,
    complaint.assignedOfficerId
      ? OfficerModel.findById(complaint.assignedOfficerId).select("name title").lean().exec()
      : null,
  ]);
  return {
    complaintNumber: complaint.complaintNumber,
    category: complaint.category,
    details: complaint.details,
    photos: complaint.photos,
    location: complaint.location,
    status: complaint.status,
    statusHistory: complaint.statusHistory,
    activityHistory: complaint.activityHistory,
    publicMessages: complaint.publicMessages,
    internalNotes: complaint.internalNotes,
    citizenFeedback: complaint.citizenFeedback?.confirmation ? complaint.citizenFeedback : null,
    contact: {
      name: complaint.contact.privateName ? null : complaint.contact.name || null,
      phone: complaint.contact.phone,
      privateName: complaint.contact.privateName,
    },
    assignedDepartment: department
      ? { id: department._id.toString(), name: department.name, code: department.code }
      : null,
    assignedOfficer: officer
      ? { id: officer._id.toString(), name: officer.name, title: officer.title }
      : null,
    slaStartedAt: complaint.slaStartedAt?.toISOString()
      ?? complaint.activityHistory.find((item) => item.type === "assigned")?.createdAt.toISOString()
      ?? null,
    slaDeadline: complaint.slaDeadline?.toISOString() ?? null,
    slaPausedAt: complaint.slaPausedAt?.toISOString() ?? null,
    createdAt: complaint.createdAt?.toISOString() ?? null,
    updatedAt: complaint.updatedAt?.toISOString() ?? null,
  };
};

export const getAdminComplaint = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const complaintNumber = typeof req.params.complaintNumber === "string" ? req.params.complaintNumber : "";
    if (!complaintNumber) {
      res.status(400).json({ error: "A complaint number is required." });
      return;
    }
    const complaint = await findComplaint(complaintNumber);
    if (!complaint) {
      res.status(404).json({ error: "Complaint not found." });
      return;
    }
    res.json({ complaint: await serializeAdminComplaint(complaint) });
  } catch (error) {
    next(error);
  }
};

export const updateAdminComplaint = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const uploadedPaths: string[] = [];
  try {
    if (!isDatabaseReady(res)) return;
    const complaintNumber = typeof req.params.complaintNumber === "string" ? req.params.complaintNumber : "";
    if (!complaintNumber) {
      res.status(400).json({ error: "A complaint number is required." });
      return;
    }
    const complaint = await findComplaint(complaintNumber);
    if (!complaint) {
      res.status(404).json({ error: "Complaint not found." });
      return;
    }
    const action = textField(req.body?.action, 20);
    const actor = req.admin?.name || req.admin?.email || "Administration";
    const now = new Date();

    if (action === "reopen") {
      if (!isClosed(complaint.status)) {
        res.status(409).json({ error: "Only a closed complaint can be reopened." });
        return;
      }
      if (complaint.slaDeadline && complaint.slaPausedAt) {
        complaint.slaDeadline = resumeSlaDeadline(complaint.slaDeadline, complaint.slaPausedAt, now);
      }
      complaint.status = "in_progress";
      complaint.slaPausedAt = null;
      complaint.statusHistory.push({
        status: "in_progress",
        message: "Complaint reopened for further action.",
        updatedBy: actor,
        createdAt: now,
      });
      complaint.activityHistory.push({
        type: "status_changed",
        status: "in_progress",
        message: "Complaint reopened for further action.",
        updatedBy: actor,
        createdAt: now,
      });
    } else if (action === "assign") {
      if (isClosed(complaint.status)) {
        res.status(409).json({ error: "A closed complaint cannot be reassigned." });
        return;
      }
      const departmentId = typeof req.body.departmentId === "string" && Types.ObjectId.isValid(req.body.departmentId)
        ? new Types.ObjectId(req.body.departmentId)
        : null;
      const officerId = typeof req.body.officerId === "string" && Types.ObjectId.isValid(req.body.officerId)
        ? new Types.ObjectId(req.body.officerId)
        : null;
      const configuredSettings = req.body.slaWorkingDays === undefined
        ? await AdminSettingsModel.findOne({ scope: "global" }).select("slaWorkingDays").lean().exec()
        : null;
      const workingDays = req.body.slaWorkingDays === undefined
        ? configuredSettings?.slaWorkingDays[complaint.category] ?? DEFAULT_SLA_WORKING_DAYS[complaint.category]
        : Number(req.body.slaWorkingDays);
      if (!departmentId || !Number.isInteger(workingDays) || workingDays < 1 || workingDays > 60) {
        res.status(400).json({ error: "Choose an active department and a resolution target from 1 to 60 working days." });
        return;
      }
      const department = await DepartmentModel.findOne({ _id: departmentId, active: true }).select("name code").exec();
      if (!department) {
        res.status(400).json({ error: "Choose an active department." });
        return;
      }
      let officerName = "";
      if (officerId) {
        const officer = await OfficerModel.findOne({
          _id: officerId,
          departmentId,
          active: true,
        }).select("name").exec();
        if (!officer) {
          res.status(400).json({ error: "Choose an active officer from the selected department." });
          return;
        }
        officerName = officer.name;
      }
      const deadline = addWorkingDays(now, workingDays);
      const assignmentMessage = `Assigned to ${department.name}${officerName ? ` · ${officerName}` : ""}. Target: ${workingDays} working day${workingDays === 1 ? "" : "s"}.`;
      complaint.assignedDepartmentId = departmentId;
      complaint.assignedOfficerId = officerId;
      complaint.slaStartedAt = now;
      complaint.slaDeadline = deadline;
      complaint.slaPausedAt = complaint.status === "waiting_for_citizen" ? now : null;
      complaint.activityHistory.push({ type: "assigned", message: assignmentMessage, updatedBy: actor, createdAt: now });
      if (complaint.status === "received") {
        complaint.status = "under_review";
        complaint.statusHistory.push({ status: "under_review", message: assignmentMessage, updatedBy: actor, createdAt: now });
        complaint.activityHistory.push({
          type: "status_changed",
          status: "under_review",
          message: assignmentMessage,
          updatedBy: actor,
          createdAt: now,
        });
      }
    } else if (action === "note") {
      const message = textField(req.body.message, 1000);
      if (!message) {
        res.status(400).json({ error: "Write an internal note of up to 1000 characters." });
        return;
      }
      complaint.internalNotes.push({ message, createdBy: actor, createdAt: now });
    } else if (action === "message") {
      if (isClosed(complaint.status)) {
        res.status(409).json({ error: "A closed complaint cannot receive new messages." });
        return;
      }
      const message = textField(req.body.message, 1000);
      const requiresResponse = req.body.requiresResponse === "true" || req.body.requiresResponse === true;
      if (!message) {
        res.status(400).json({ error: "Write a citizen-facing message of up to 1000 characters." });
        return;
      }
      const files = Array.isArray(req.files) ? req.files : [];
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
      complaint.publicMessages.push({
        sender: "admin",
        senderName: actor,
        message,
        photos: photoUrls,
        requiresResponse,
        createdAt: now,
      });
      if (requiresResponse && complaint.status !== "waiting_for_citizen") {
        complaint.status = "waiting_for_citizen";
        complaint.slaPausedAt = now;
        complaint.statusHistory.push({
          status: "waiting_for_citizen",
          message,
          updatedBy: actor,
          createdAt: now,
        });
      }
      complaint.activityHistory.push({
        type: "status_changed",
        status: complaint.status,
        message,
        updatedBy: actor,
        createdAt: now,
      });
    } else if (action === "status") {
      const nextStatus = textField(req.body.status, 32) as ComplaintStatus | null;
      const message = textField(req.body.message, 1000);
      const allowedStatuses: ComplaintStatus[] = [
        "under_review",
        "in_progress",
        "waiting_for_citizen",
        "resolved",
        "rejected",
      ];
      if (!nextStatus || !allowedStatuses.includes(nextStatus)) {
        res.status(400).json({ error: "Choose a supported complaint status." });
        return;
      }
      if (isClosed(complaint.status)) {
        res.status(409).json({ error: "A closed complaint cannot change status." });
        return;
      }
      if (nextStatus === complaint.status) {
        res.status(409).json({ error: "The complaint already has that status." });
        return;
      }
      if (nextStatus === "waiting_for_citizen" && !message) {
        res.status(400).json({ error: "Explain what information is needed from the citizen." });
        return;
      }
      if (nextStatus === "rejected" && (!message || message.length < 3)) {
        res.status(400).json({ error: "A rejection reason of at least 3 characters is required." });
        return;
      }
      if (nextStatus === "resolved" && (!message || message.length < 3)) {
        res.status(400).json({ error: "Describe how the complaint was resolved." });
        return;
      }

      const files = Array.isArray(req.files) ? req.files : [];
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
      if ((wasWaiting || isClosed(complaint.status)) && !isClosed(nextStatus)) {
        if (complaint.slaDeadline && complaint.slaPausedAt) {
          complaint.slaDeadline = resumeSlaDeadline(complaint.slaDeadline, complaint.slaPausedAt, now);
        }
        complaint.slaPausedAt = null;
      } else if (nextStatus === "waiting_for_citizen" || isClosed(nextStatus)) {
        complaint.slaPausedAt = now;
      }
      complaint.status = nextStatus;
      complaint.statusHistory.push({
        status: nextStatus,
        ...(message ? { message } : {}),
        updatedBy: actor,
        photos: photoUrls,
        createdAt: now,
      });
      const activityType = nextStatus === "resolved"
        ? "resolved"
        : nextStatus === "rejected"
          ? "rejected"
          : "status_changed";
      complaint.activityHistory.push({
        type: activityType,
        status: nextStatus,
        ...(message ? { message } : {}),
        updatedBy: actor,
        createdAt: now,
      });
      if (message) {
        complaint.publicMessages.push({
          sender: "admin",
          senderName: actor,
          message,
          photos: photoUrls,
          requiresResponse: nextStatus === "waiting_for_citizen",
          createdAt: now,
        });
      }
    } else {
      res.status(400).json({ error: "Choose a supported complaint action." });
      return;
    }

    await complaint.save();
    res.json({ complaint: await serializeAdminComplaint(complaint) });
  } catch (error) {
    await Promise.all(
      uploadedPaths.map((path) =>
        deleteFile(path).catch((cleanupError: unknown) => {
          console.error("Failed to remove an unassociated admin complaint photo:", cleanupError);
        }),
      ),
    );
    next(error);
  }
};
