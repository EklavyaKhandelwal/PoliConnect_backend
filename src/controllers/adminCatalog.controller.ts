import type { NextFunction, Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { DepartmentModel } from "../models/department.model";
import { OfficerModel } from "../models/officer.model";
import { REPLY_TEMPLATE_LANGUAGES, ReplyTemplateModel } from "../models/replyTemplate.model";

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Admin settings are unavailable. Please try again shortly." });
  return false;
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === 11000;

const duplicateResponse = (res: Response, error: unknown): boolean => {
  if (!isDuplicateKeyError(error)) return false;
  res.status(409).json({ error: "A record with that unique value already exists." });
  return true;
};

const getBody = (req: Request, res: Response): Record<string, unknown> | null => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Provide settings as a JSON object." });
    return null;
  }
  return req.body as Record<string, unknown>;
};

const validText = (
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
  required: boolean,
): string | null | undefined => {
  const value = body[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((!normalized && required) || normalized.length > maxLength) return null;
  return normalized;
};

const validActive = (body: Record<string, unknown>): boolean | null | undefined => {
  if (body.active === undefined) return undefined;
  return typeof body.active === "boolean" ? body.active : null;
};

const isValidId = (req: Request, res: Response): Types.ObjectId | null => {
  const rawId = req.params.id;
  if (typeof rawId !== "string" || !Types.ObjectId.isValid(rawId)) {
    res.status(400).json({ error: "A valid settings record ID is required." });
    return null;
  }
  return new Types.ObjectId(rawId);
};

export const listDepartments = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const departments = await DepartmentModel.find().sort({ active: -1, name: 1 }).lean().exec();
    res.json({ departments });
  } catch (error) {
    next(error);
  }
};

export const createDepartment = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const body = getBody(req, res);
    if (!body) return;
    const name = validText(body, "name", 100, true);
    const code = validText(body, "code", 20, true);
    const description = validText(body, "description", 500, false);
    if (typeof name !== "string" || typeof code !== "string" || description === null) {
      res.status(400).json({ error: "Department name and code are required; text must be within the allowed length." });
      return;
    }
    const department = await DepartmentModel.create({
      name,
      code: code.toUpperCase(),
      description: description ?? "",
      active: true,
    });
    res.status(201).json({ department });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    next(error);
  }
};

export const updateDepartment = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const id = isValidId(req, res);
    if (!id) return;
    const body = getBody(req, res);
    if (!body) return;
    const name = validText(body, "name", 100, false);
    const code = validText(body, "code", 20, false);
    const description = validText(body, "description", 500, false);
    const active = validActive(body);
    if (name === null || (name !== undefined && !name) ||
      code === null || (code !== undefined && !code) || description === null || active === null ||
      (name === undefined && code === undefined && description === undefined && active === undefined)) {
      res.status(400).json({ error: "Provide valid department fields to update." });
      return;
    }
    if (active === false && await OfficerModel.exists({ departmentId: id, active: true })) {
      res.status(409).json({ error: "Reassign or deactivate this department’s active officers before deactivating the department." });
      return;
    }
    const department = await DepartmentModel.findByIdAndUpdate(
      id,
      {
        ...(name === undefined ? {} : { name }),
        ...(code === undefined ? {} : { code: code.toUpperCase() }),
        ...(description === undefined ? {} : { description }),
        ...(active === undefined ? {} : { active }),
      },
      { returnDocument: "after", runValidators: true },
    ).exec();
    if (!department) {
      res.status(404).json({ error: "Department not found." });
      return;
    }
    res.json({ department });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    next(error);
  }
};

export const listOfficers = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const officers = await OfficerModel.find()
      .populate("departmentId", "name code active")
      .sort({ active: -1, name: 1 })
      .lean()
      .exec();
    res.json({ officers });
  } catch (error) {
    next(error);
  }
};

export const createOfficer = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const body = getBody(req, res);
    if (!body) return;
    const name = validText(body, "name", 100, true);
    const title = validText(body, "title", 100, true);
    const email = validText(body, "email", 254, false);
    const phone = validText(body, "phone", 30, false);
    const departmentId = typeof body.departmentId === "string" && Types.ObjectId.isValid(body.departmentId)
      ? new Types.ObjectId(body.departmentId)
      : null;
    if (
      typeof name !== "string" ||
      typeof title !== "string" ||
      email === null ||
      phone === null ||
      !departmentId
    ) {
      res.status(400).json({ error: "Provide a valid officer name, title, and department; contact details are optional." });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid officer email address." });
      return;
    }
    const department = await DepartmentModel.findOne({ _id: departmentId, active: true }).select("_id").exec();
    if (!department) {
      res.status(400).json({ error: "Choose an active department for this officer." });
      return;
    }
    const officer = await OfficerModel.create({
      name,
      title,
      departmentId,
      email: email?.toLowerCase() ?? "",
      phone: phone ?? "",
      active: true,
    });
    await officer.populate("departmentId", "name code active");
    res.status(201).json({ officer });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    next(error);
  }
};

export const updateOfficer = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const id = isValidId(req, res);
    if (!id) return;
    const body = getBody(req, res);
    if (!body) return;
    const name = validText(body, "name", 100, false);
    const title = validText(body, "title", 100, false);
    const email = validText(body, "email", 254, false);
    const phone = validText(body, "phone", 30, false);
    const active = validActive(body);
    const departmentId = body.departmentId === undefined
      ? undefined
      : typeof body.departmentId === "string" && Types.ObjectId.isValid(body.departmentId)
        ? new Types.ObjectId(body.departmentId)
        : null;
    if (
      name === null || (name !== undefined && !name) ||
      title === null || (title !== undefined && !title) || email === null || phone === null ||
      active === null || departmentId === null ||
      (name === undefined && title === undefined && email === undefined && phone === undefined && active === undefined && departmentId === undefined)
    ) {
      res.status(400).json({ error: "Provide valid officer fields to update." });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid officer email address." });
      return;
    }
    if (departmentId) {
      const department = await DepartmentModel.findOne({ _id: departmentId, active: true }).select("_id").exec();
      if (!department) {
        res.status(400).json({ error: "Choose an active department for this officer." });
        return;
      }
    }
    const officer = await OfficerModel.findByIdAndUpdate(
      id,
      {
        ...(name === undefined ? {} : { name }),
        ...(title === undefined ? {} : { title }),
        ...(email === undefined ? {} : { email: email.toLowerCase() }),
        ...(phone === undefined ? {} : { phone }),
        ...(active === undefined ? {} : { active }),
        ...(departmentId === undefined ? {} : { departmentId }),
      },
      { returnDocument: "after", runValidators: true },
    ).populate("departmentId", "name code active").exec();
    if (!officer) {
      res.status(404).json({ error: "Officer not found." });
      return;
    }
    res.json({ officer });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    next(error);
  }
};

export const listReplyTemplates = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const templates = await ReplyTemplateModel.find().sort({ active: -1, language: 1, title: 1 }).lean().exec();
    res.json({ templates });
  } catch (error) {
    next(error);
  }
};

export const createReplyTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const body = getBody(req, res);
    if (!body) return;
    const title = validText(body, "title", 100, true);
    const message = validText(body, "message", 2000, true);
    const language = typeof body.language === "string" &&
      REPLY_TEMPLATE_LANGUAGES.includes(body.language as (typeof REPLY_TEMPLATE_LANGUAGES)[number])
      ? body.language as (typeof REPLY_TEMPLATE_LANGUAGES)[number]
      : null;
    if (typeof title !== "string" || typeof message !== "string" || !language) {
      res.status(400).json({ error: "Provide a title, message, and supported template language." });
      return;
    }
    const template = await ReplyTemplateModel.create({ title, message, language, active: true });
    res.status(201).json({ template });
  } catch (error) {
    next(error);
  }
};

export const updateReplyTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const id = isValidId(req, res);
    if (!id) return;
    const body = getBody(req, res);
    if (!body) return;
    const title = validText(body, "title", 100, false);
    const message = validText(body, "message", 2000, false);
    const active = validActive(body);
    const language = body.language === undefined
      ? undefined
      : typeof body.language === "string" &&
        REPLY_TEMPLATE_LANGUAGES.includes(body.language as (typeof REPLY_TEMPLATE_LANGUAGES)[number])
        ? body.language as (typeof REPLY_TEMPLATE_LANGUAGES)[number]
        : null;
    if (
      title === null || (title !== undefined && !title) ||
      message === null || (message !== undefined && !message) || active === null || language === null ||
      (title === undefined && message === undefined && active === undefined && language === undefined)
    ) {
      res.status(400).json({ error: "Provide valid reply template fields to update." });
      return;
    }
    const template = await ReplyTemplateModel.findByIdAndUpdate(
      id,
      {
        ...(title === undefined ? {} : { title }),
        ...(message === undefined ? {} : { message }),
        ...(language === undefined ? {} : { language }),
        ...(active === undefined ? {} : { active }),
      },
      { returnDocument: "after", runValidators: true },
    ).exec();
    if (!template) {
      res.status(404).json({ error: "Reply template not found." });
      return;
    }
    res.json({ template });
  } catch (error) {
    next(error);
  }
};
