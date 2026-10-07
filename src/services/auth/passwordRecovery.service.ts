import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcrypt";
import { Types } from "mongoose";
import { PasswordRecoveryModel, type RecoveryScope } from "../../models/passwordRecovery.model";
import { RefreshTokenModel } from "../../models/refreshToken.model";
import { UserModel } from "../../models/user.model";
import {
  assertPasswordRecoveryEmailConfigured,
  sendPasswordRecoveryCode,
} from "../email/email.service";

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_CODE_ATTEMPTS = 5;

export class PasswordRecoveryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const hashCode = (userId: Types.ObjectId, scope: RecoveryScope, code: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured.");
  return createHmac("sha256", secret).update(`${scope}:${userId}:${code}`).digest("hex");
};

const isSameHash = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export async function requestPasswordRecoveryCode(
  email: string,
  scope: RecoveryScope,
): Promise<void> {
  try {
    assertPasswordRecoveryEmailConfigured();
  } catch {
    throw new PasswordRecoveryError(
      "Password recovery email is temporarily unavailable.",
      503,
    );
  }
  const normalizedEmail = normalizeEmail(email);
  const roleFilter = scope === "citizen"
    ? { role: "citizen" as const }
    : { role: { $in: ["admin", "owner"] as const } };
  const user = await UserModel.findOne({ email: normalizedEmail, ...roleFilter })
    .select("_id email")
    .exec();
  if (!user) return;

  const now = new Date();
  let challenge = await PasswordRecoveryModel.findOne({ userId: user._id, scope }).exec();
  if (challenge) {
    const windowExpired = now.getTime() - challenge.requestWindowStartedAt.getTime() >= REQUEST_WINDOW_MS;
    if (
      (!windowExpired && challenge.requestCount >= MAX_REQUESTS_PER_WINDOW) ||
      now.getTime() - challenge.lastSentAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return;
    }
  }

  const code = randomInt(100000, 1000000).toString();
  const codeHash = hashCode(user._id, scope, code);
  const windowExpired = !challenge ||
    now.getTime() - challenge.requestWindowStartedAt.getTime() >= REQUEST_WINDOW_MS;

  if (!challenge) {
    try {
      challenge = await PasswordRecoveryModel.create({
        userId: user._id,
        scope,
        codeHash,
        codeExpiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
        attempts: 0,
        requestWindowStartedAt: now,
        requestCount: 1,
        lastSentAt: now,
        deleteAfter: new Date(now.getTime() + REQUEST_WINDOW_MS),
      });
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== 11000
      ) {
        throw error;
      }
      return requestPasswordRecoveryCode(email, scope);
    }
  } else {
    const updated = await PasswordRecoveryModel.findOneAndUpdate(
      {
        _id: challenge._id,
        lastSentAt: challenge.lastSentAt,
        requestCount: challenge.requestCount,
      },
      {
        $set: {
          codeHash,
          codeExpiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
          attempts: 0,
          requestWindowStartedAt: windowExpired ? now : challenge.requestWindowStartedAt,
          requestCount: windowExpired ? 1 : challenge.requestCount + 1,
          lastSentAt: now,
          deleteAfter: new Date(now.getTime() + REQUEST_WINDOW_MS),
        },
      },
      { returnDocument: "after" },
    ).exec();
    if (!updated) return;
    challenge = updated;
  }

  try {
    await sendPasswordRecoveryCode(normalizedEmail, code, scope);
  } catch (error) {
    await PasswordRecoveryModel.updateOne(
      { _id: challenge._id, codeHash },
      { $set: { codeHash: "", codeExpiresAt: now } },
    ).exec();
    console.error(
      "Password recovery email delivery failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw new PasswordRecoveryError(
      "Password recovery email is temporarily unavailable. Please try again shortly.",
      503,
    );
  }
}

export async function resetPasswordWithCode(
  email: string,
  code: string,
  newPassword: string,
  scope: RecoveryScope,
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  const roleFilter = scope === "citizen"
    ? { role: "citizen" as const }
    : { role: { $in: ["admin", "owner"] as const } };
  const user = await UserModel.findOne({ email: normalizedEmail, ...roleFilter })
    .select("_id")
    .exec();
  if (!user) {
    throw new PasswordRecoveryError("The code is invalid or has expired.", 400);
  }

  const challenge = await PasswordRecoveryModel.findOne({
    userId: user._id,
    scope,
    codeExpiresAt: { $gt: new Date() },
    attempts: { $lt: MAX_CODE_ATTEMPTS },
  }).exec();
  if (!challenge || !/^\d{6}$/.test(code)) {
    throw new PasswordRecoveryError("The code is invalid or has expired.", 400);
  }

  if (!isSameHash(challenge.codeHash, hashCode(user._id, scope, code))) {
    await PasswordRecoveryModel.updateOne(
      { _id: challenge._id, attempts: { $lt: MAX_CODE_ATTEMPTS } },
      { $inc: { attempts: 1 } },
    ).exec();
    throw new PasswordRecoveryError("The code is invalid or has expired.", 400);
  }

  const claimed = await PasswordRecoveryModel.findOneAndUpdate(
    {
      _id: challenge._id,
      codeHash: challenge.codeHash,
      attempts: challenge.attempts,
      codeExpiresAt: { $gt: new Date() },
    },
    { $set: { codeHash: "", codeExpiresAt: new Date(0), attempts: MAX_CODE_ATTEMPTS } },
    { returnDocument: "before" },
  ).exec();
  if (!claimed) {
    throw new PasswordRecoveryError("The code is invalid or has expired.", 400);
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updatedUser = await UserModel.updateOne(
      { _id: user._id },
      { $set: { password: passwordHash }, $inc: { authVersion: 1 } },
    ).exec();
    if (updatedUser.matchedCount !== 1) {
      throw new PasswordRecoveryError("The code is invalid or has expired.", 400);
    }
    await RefreshTokenModel.deleteMany({
      userId: user._id,
      purpose: scope === "citizen" ? "citizen" : "admin",
    }).exec();
    await PasswordRecoveryModel.deleteOne({ _id: challenge._id }).exec();
  } catch (error) {
    await PasswordRecoveryModel.updateOne(
      { _id: challenge._id, codeHash: "" },
      { $set: { codeHash: claimed.codeHash, codeExpiresAt: claimed.codeExpiresAt, attempts: claimed.attempts } },
    ).exec();
    throw error;
  }
}
