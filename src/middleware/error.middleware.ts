import type { Request, Response, NextFunction } from "express";
import { AiServiceError } from "../services/ai/aiReliability.service";

interface ApiError {
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const failure = err as ApiError;
  const status = typeof failure?.status === "number" ? failure.status : 500;
  console.error("Unhandled API error:", {
    method: req.method,
    path: req.path,
    status,
    code: typeof failure?.code === "string" ? failure.code : undefined,
    name: err instanceof Error ? err.name : "UnknownError",
  });

  if (failure?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "The uploaded file is too large. Choose a file no larger than 15 MB.",
      code: "FILE_TOO_LARGE",
    });
  }

  if (err instanceof AiServiceError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  if (status === 413 || failure?.code === "rate_limit_exceeded") {
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