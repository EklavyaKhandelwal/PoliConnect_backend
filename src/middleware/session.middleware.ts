import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { sessionRepository } from "../repositories/session.repository";

const GUEST_HEADER = "x-guest-id";

declare global {
  namespace Express {
    interface Request {
      session: { sessionId: string; userId: string | null; guestId: string | null };
    }
  }
}


export async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const authToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  
  if (authToken) {
    try {
      if (!process.env.JWT_SECRET) {
        return res.status(500).json({ error: "JWT_SECRET is not configured" });
      }
      const payload = jwt.verify(authToken, process.env.JWT_SECRET);
      if (
        typeof payload === "string" ||
        payload.tokenType === "admin" ||
        typeof payload.userId !== "string" ||
        !Types.ObjectId.isValid(payload.userId)
      ) {
        return res.status(401).json({ error: "Invalid or expired auth token." });
      }
      const userId = new Types.ObjectId(payload.userId);

      const session = await sessionRepository.findSessionByUserId(userId);
      if (!session) {
        return res.status(401).json({ error: "Session not found for this token. Please log in again." });
      }

      req.session = {
        sessionId: session._id.toString(),
        userId: payload.userId,
        guestId: null,
      };
      return next();
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired auth token." });
    }
  }


  let guestId = req.headers[GUEST_HEADER] as string | undefined;

  if (!guestId) {
    guestId = randomUUID();
    res.setHeader("x-guest-id", guestId);
  }

  try {

    const existingSessions = await sessionRepository.findByGuestId(guestId);
    let session = existingSessions[0];
    if (!session) {
      session = await sessionRepository.create({ guestId });
    }
    req.session = { sessionId: session._id.toString(), userId: null, guestId };

    next();

  } catch (err) {
    console.error("Failed to resolve guest session:", err);
    res.status(500).json({ error: "Failed to resolve guest session." });
  }
}