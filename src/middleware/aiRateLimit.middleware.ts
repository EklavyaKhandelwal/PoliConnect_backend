import rateLimit from "express-rate-limit";

export const aiRequestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session.sessionId,
  message: {
    error: "Too many assistant requests. Please try again in a few minutes.",
    code: "AI_RATE_LIMITED",
  },
});
