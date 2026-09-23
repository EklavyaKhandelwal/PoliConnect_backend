import type { Request, Response, NextFunction } from "express";

export function errorMiddleware(err: any, req: Request, res: Response, next: NextFunction) {
  const status = typeof err.status === "number" ? err.status : 500;
  console.error("Unhandled API error:", err);

  if (status === 413 || err.code === "rate_limit_exceeded" || err.message?.includes("tokens per minute")) {
    return res.status(413).json({
      error: "This answer is too large to prepare right now. Please try a shorter question.",
      code: "REQUEST_TOO_LARGE",
    });
  }
  if (status === 429) {
    return res.status(429).json({
      error: "The assistant is busy right now. Please try again shortly.",
      code: "RATE_LIMITED",
    });
  }
  return res.status(status).json({
    error: status >= 500
      ? "The assistant is temporarily unavailable. Please try again."
      : "Unable to process this request. Please try again.",
    code: "REQUEST_FAILED",
  });
}