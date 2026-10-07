import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { RefreshTokenModel } from "../models/refreshToken.model";
import { UserModel } from "../models/user.model";
import type { AccountRole } from "../types/common.types";

declare global {
  namespace Express {
    interface Request {
      admin?: {
        userId: string;
        email: string;
        name: string;
        role: Extract<AccountRole, "admin" | "owner">;
      };
    }
  }
}

export const adminAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
    if (!token || !process.env.JWT_SECRET) {
      res.status(401).json({ error: "Admin sign-in is required." });
      return;
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (
      typeof payload === "string" ||
      payload.tokenType !== "admin" ||
      typeof payload.userId !== "string" ||
      !Types.ObjectId.isValid(payload.userId) ||
      typeof payload.adminSessionId !== "string" ||
      payload.adminSessionId.length > 100
    ) {
      res.status(401).json({ error: "Admin sign-in is required." });
      return;
    }

    const user = await UserModel.findById(payload.userId).select("email name role").exec();
    if (!user || (user.role !== "admin" && user.role !== "owner")) {
      res.status(403).json({ error: "This account is not authorized for the admin dashboard." });
      return;
    }

    const activeSession = await RefreshTokenModel.exists({
      userId: user._id,
      purpose: "admin",
      adminSessionId: payload.adminSessionId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!activeSession) {
      res.status(401).json({ error: "Admin session has ended. Please sign in again." });
      return;
    }

    req.admin = {
      userId: user._id.toString(),
      email: user.email,
      name: user.name ?? "",
      role: user.role,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Admin sign-in has expired. Please sign in again." });
      return;
    }
    next(error);
  }
};

export const ownerOnlyMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (req.admin?.role !== "owner") {
    res.status(403).json({ error: "Only the admin owner can perform this action." });
    return;
  }
  next();
};
