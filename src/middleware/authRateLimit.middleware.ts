import rateLimit from "express-rate-limit";

const createLimiter = (limit: number, windowMs: number, message: string) =>
  rateLimit({
    limit,
    windowMs,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });

export const loginRateLimit = createLimiter(
  10,
  15 * 60 * 1000,
  "Too many sign-in attempts. Please try again later.",
);

export const recoveryRequestRateLimit = createLimiter(
  5,
  60 * 60 * 1000,
  "Too many recovery requests. Please try again later.",
);

export const recoveryResetRateLimit = createLimiter(
  10,
  15 * 60 * 1000,
  "Too many password reset attempts. Please try again later.",
);
