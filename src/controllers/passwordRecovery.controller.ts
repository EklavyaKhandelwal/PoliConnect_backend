import type { NextFunction, Request, Response } from "express";
import {
  PasswordRecoveryError,
  requestPasswordRecoveryCode,
  resetPasswordWithCode,
} from "../services/auth/passwordRecovery.service";
import type { RecoveryScope } from "../models/passwordRecovery.model";

const isEmail = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const requestPasswordRecovery = (scope: RecoveryScope) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!isEmail(req.body?.email)) {
        res.status(400).json({ error: "Enter a valid email address." });
        return;
      }
      await requestPasswordRecoveryCode(req.body.email, scope);
      res.json({
        success: true,
        message: "If an account matches that email, a password reset code will be sent.",
      });
    } catch (error) {
      if (error instanceof PasswordRecoveryError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  };

export const resetPassword = (scope: RecoveryScope) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, code, password } = req.body ?? {};
      if (
        !isEmail(email) ||
        typeof code !== "string" ||
        typeof password !== "string" ||
        password.length < 12 ||
        Buffer.byteLength(password, "utf8") > 72
      ) {
        res.status(400).json({
          error: "Enter a valid email and 6-digit code, and use a password of at least 12 characters and no more than 72 UTF-8 bytes.",
        });
        return;
      }
      await resetPasswordWithCode(email, code, password, scope);
      res.json({ success: true, message: "Password updated. Sign in with your new password." });
    } catch (error) {
      if (error instanceof PasswordRecoveryError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
