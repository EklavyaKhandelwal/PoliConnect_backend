import  type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { userRepository } from "../repositories/user.repository";
import { sessionRepository } from "../repositories/session.repository";
import { RefreshTokenModel } from "../models/refreshToken.model";
import { SessionModel } from "../models/session.model";
import { ConversationModel } from "../models/conversation.model";
import { MessageModel } from "../models/message.model";

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_DAYS = 30;
const REFRESH_COOKIE = "citizen_refresh_token";

const getJwtSecret = (): string => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return process.env.JWT_SECRET;
};

const hashRefreshToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: (process.env.COOKIE_SAME_SITE ?? "lax") as "lax" | "strict" | "none",
  path: "/api/v1/user",
  maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
};

const getRefreshCookie = (req: Request): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const entry = header.split(";").map((item) => item.trim()).find((item) =>
    item.startsWith(`${REFRESH_COOKIE}=`),
  );
  return entry?.slice(`${REFRESH_COOKIE}=`.length);
};

const publicUser = (user: { _id: Types.ObjectId; email: string; name?: string }) => ({
  id: user._id.toString(),
  email: user.email,
  name: user.name,
});

async function issueTokens(userId: Types.ObjectId, res: Response): Promise<string> {
  const refreshToken = randomBytes(64).toString("base64url");
  const expiresAt = new Date(Date.now() + cookieOptions.maxAge);
  await RefreshTokenModel.create({
    tokenHash: hashRefreshToken(refreshToken),
    userId,
    expiresAt,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions);
  return jwt.sign({ userId: userId.toString() }, getJwtSecret(), {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

export async function signup(req: Request, res: Response) {

  const { email, password, name } = req.body;
  
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });
  const alreadyExists = await userRepository.existsByEmail(email);

  if (alreadyExists) return res.status(409).json({ error: "Email already registered" });
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await userRepository.create({ email, password: hashedPassword, name });

  await sessionRepository.create({ userId: user._id, guestId: null });

  const token = await issueTokens(user._id, res);

  res.status(201).json({
    accessToken: token,
    user: publicUser(user),
  });

}

export async function login(req: Request, res: Response) {

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  const user = await userRepository.findByEmail(email);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const existingSession = await sessionRepository.findSessionByUserId(user._id);
  if (!existingSession) {
    await sessionRepository.create({ userId: user._id, guestId: null });
  }

  const token = await issueTokens(user._id, res);

  res.json({
    accessToken: token,
    user: publicUser(user),
  });
}

export async function logout(req: Request, res: Response) {
  const refreshToken = getRefreshCookie(req);
  if (refreshToken) {
    await RefreshTokenModel.updateOne(
      { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    ).exec();
  }
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.json({ success: true });
}

export async function refresh(req: Request, res: Response) {
  const currentToken = getRefreshCookie(req);
  if (!currentToken) return res.status(401).json({ error: "Refresh token is required" });

  const currentHash = hashRefreshToken(currentToken);
  const storedToken = await RefreshTokenModel.findOne({ tokenHash: currentHash }).exec();
  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt.getTime() <= Date.now()) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  const nextRefreshToken = randomBytes(64).toString("base64url");
  const nextHash = hashRefreshToken(nextRefreshToken);
  await RefreshTokenModel.create({
    tokenHash: nextHash,
    userId: storedToken.userId,
    expiresAt: new Date(Date.now() + cookieOptions.maxAge),
  });
  storedToken.revokedAt = new Date();
  storedToken.replacedByTokenHash = nextHash;
  await storedToken.save();

  const user = await userRepository.findById(storedToken.userId);
  if (!user) return res.status(401).json({ error: "User not found" });

  res.cookie(REFRESH_COOKIE, nextRefreshToken, cookieOptions);
  res.json({
    accessToken: jwt.sign({ userId: user._id.toString() }, getJwtSecret(), {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    }),
    user: publicUser(user),
  });
}


export async function getMe(req: Request, res: Response) {

    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });

    const user = await userRepository.findById(new Types.ObjectId(req.session.userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ user: publicUser(user) });
}

export async function deleteAccount(req: Request, res: Response) {
  if (!req.session.userId) return res.status(401).json({ error: "You must be signed in to delete your account." });

  const userId = new Types.ObjectId(req.session.userId);
  const sessions = await SessionModel.find({ userId }).select("_id").lean().exec();
  const sessionIds = sessions.map((session) => session._id);
  const conversations = await ConversationModel.find({ sessionId: { $in: sessionIds } }).select("_id").lean().exec();
  const conversationIds = conversations.map((conversation) => conversation._id);

  await MessageModel.deleteMany({ conversationId: { $in: conversationIds } }).exec();
  await ConversationModel.deleteMany({ _id: { $in: conversationIds } }).exec();
  await SessionModel.deleteMany({ userId }).exec();
  await RefreshTokenModel.deleteMany({ userId }).exec();
  await userRepository.deleteById(userId);

  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.json({ success: true });
}