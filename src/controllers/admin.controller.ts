import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { RefreshTokenModel } from "../models/refreshToken.model";
import { UserModel } from "../models/user.model";
import type { AccountRole } from "../types/common.types";

const ADMIN_REFRESH_COOKIE = "citizen_admin_refresh_token";
const ADMIN_ACCESS_TOKEN_EXPIRES_IN = "15m";
const ADMIN_REFRESH_TOKEN_DAYS = 7;
const ADMIN_REFRESH_MAX_AGE = ADMIN_REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000;

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: (process.env.COOKIE_SAME_SITE === "none"
    ? "none"
    : process.env.COOKIE_SAME_SITE === "strict"
      ? "strict"
      : "lax") as "lax" | "strict" | "none",
  path: "/api/v1/admin",
  maxAge: ADMIN_REFRESH_MAX_AGE,
};

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const getRefreshCookie = (req: Request): string | undefined => {
  const entry = req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_REFRESH_COOKIE}=`));
  return entry?.slice(`${ADMIN_REFRESH_COOKIE}=`.length);
};

const publicAdmin = (user: {
  _id: mongoose.Types.ObjectId;
  email: string;
  name?: string;
  role?: AccountRole;
}) => ({
  id: user._id.toString(),
  email: user.email,
  name: user.name ?? "",
  role: user.role ?? "citizen",
});

const issueAdminAccessToken = (userId: string, adminSessionId: string): string => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured.");
  return jwt.sign({ userId, adminSessionId, tokenType: "admin" }, process.env.JWT_SECRET, {
    expiresIn: ADMIN_ACCESS_TOKEN_EXPIRES_IN,
  });
};

const issueAdminRefreshToken = async (
  userId: mongoose.Types.ObjectId,
  adminSessionId: string,
): Promise<string> => {
  const token = randomBytes(64).toString("base64url");
  await RefreshTokenModel.create({
    tokenHash: hashToken(token),
    userId,
    purpose: "admin",
    adminSessionId,
    expiresAt: new Date(Date.now() + ADMIN_REFRESH_MAX_AGE),
  });
  return token;
};

const isDatabaseReady = (res: Response): boolean => {
  if (mongoose.connection.readyState === 1) return true;
  res.status(503).json({ error: "Admin authentication is unavailable. Please try again shortly." });
  return false;
};

export const adminLogin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Enter your admin email and password." });
      return;
    }
    const { email, password } = req.body as { email?: unknown; password?: unknown };
    if (
      typeof email !== "string" ||
      email.trim().length > 254 ||
      typeof password !== "string" ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      res.status(401).json({ error: "Invalid admin email or password." });
      return;
    }

    const user = await UserModel.findOne({ email: email.trim().toLowerCase() })
      .select("+password")
      .exec();
    if (!user || !(await bcrypt.compare(password, user.password)) ||
      (user.role !== "admin" && user.role !== "owner")) {
      res.status(401).json({ error: "Invalid admin email or password." });
      return;
    }

    const adminSessionId = randomUUID();
    const refreshToken = await issueAdminRefreshToken(user._id, adminSessionId);
    res.cookie(ADMIN_REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    res.json({
      accessToken: issueAdminAccessToken(user._id.toString(), adminSessionId),
      admin: publicAdmin(user),
    });
  } catch (error) {
    next(error);
  }
};

export const adminRefresh = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    const token = getRefreshCookie(req);
    if (!token) {
      res.status(401).json({ error: "Admin sign-in has expired. Please sign in again." });
      return;
    }

    const currentHash = hashToken(token);
    const storedToken = await RefreshTokenModel.findOne({
      tokenHash: currentHash,
      purpose: "admin",
    }).exec();
    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt.getTime() <= Date.now()) {
      res.clearCookie(ADMIN_REFRESH_COOKIE, refreshCookieOptions);
      res.status(401).json({ error: "Admin sign-in has expired. Please sign in again." });
      return;
    }

    const user = await UserModel.findById(storedToken.userId).exec();
    if (!user || (user.role !== "admin" && user.role !== "owner")) {
      await RefreshTokenModel.updateOne(
        { _id: storedToken._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      ).exec();
      res.clearCookie(ADMIN_REFRESH_COOKIE, refreshCookieOptions);
      res.status(401).json({ error: "This account is no longer authorized for the admin dashboard." });
      return;
    }
    if (!storedToken.adminSessionId) {
      res.clearCookie(ADMIN_REFRESH_COOKIE, refreshCookieOptions);
      res.status(401).json({ error: "Admin sign-in has expired. Please sign in again." });
      return;
    }

    const nextToken = await issueAdminRefreshToken(user._id, storedToken.adminSessionId);
    const nextHash = hashToken(nextToken);
    const rotatedToken = await RefreshTokenModel.findOneAndUpdate(
      {
        _id: storedToken._id,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { revokedAt: new Date(), replacedByTokenHash: nextHash } },
      { returnDocument: "before" },
    ).exec();
    if (!rotatedToken) {
      await RefreshTokenModel.updateOne(
        { tokenHash: nextHash, purpose: "admin", revokedAt: null },
        { $set: { revokedAt: new Date() } },
      ).exec();
      res.clearCookie(ADMIN_REFRESH_COOKIE, refreshCookieOptions);
      res.status(401).json({ error: "Admin sign-in has expired. Please sign in again." });
      return;
    }

    res.cookie(ADMIN_REFRESH_COOKIE, nextToken, refreshCookieOptions);
    res.json({
      accessToken: issueAdminAccessToken(user._id.toString(), storedToken.adminSessionId),
      admin: publicAdmin(user),
    });
  } catch (error) {
    next(error);
  }
};

export const adminLogout = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = getRefreshCookie(req);
    if (token) {
      const refreshSession = await RefreshTokenModel.findOne({
        tokenHash: hashToken(token),
        purpose: "admin",
        revokedAt: null,
      }).select("adminSessionId").exec();
      if (refreshSession?.adminSessionId) {
        await RefreshTokenModel.updateMany(
          { adminSessionId: refreshSession.adminSessionId, purpose: "admin", revokedAt: null },
          { $set: { revokedAt: new Date() } },
        ).exec();
      }
    }
    res.clearCookie(ADMIN_REFRESH_COOKIE, refreshCookieOptions);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const getAdminProfile = (req: Request, res: Response): void => {
  res.json({ admin: req.admin });
};

export const createAdminAccount = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isDatabaseReady(res)) return;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Provide admin account details." });
      return;
    }

    const { email, password, name } = req.body as {
      email?: unknown;
      password?: unknown;
      name?: unknown;
    };
    if (
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      email.trim().length > 254 ||
      typeof password !== "string" ||
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72 ||
      (name !== undefined && (typeof name !== "string" || name.trim().length > 100))
    ) {
      res.status(400).json({
        error: "Provide a valid email, a password of at least 12 characters and no more than 72 UTF-8 bytes, and a name no longer than 100 characters.",
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (await UserModel.exists({ email: normalizedEmail })) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }

    const user = await UserModel.create({
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12),
      name: typeof name === "string" ? name.trim() : "",
      role: "admin",
    });
    res.status(201).json({ admin: publicAdmin(user) });
  } catch (error) {
    next(error);
  }
};
