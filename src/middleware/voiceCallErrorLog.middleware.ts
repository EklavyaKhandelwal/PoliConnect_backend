import type { RequestHandler } from "express";

let nextRequestId = 0;

const createRequestLogger = (service: string): RequestHandler => (req, res, next) => {
  const requestId = ++nextRequestId;
  const path = `${req.baseUrl}${req.path}`;
  const startedAt = Date.now();
  console.log(`[${service}] request received:`, {
    requestId,
    method: req.method,
    path,
  });

  res.on("finish", () => {
    const log = res.statusCode >= 400 ? console.error : console.log;
    log(`[${service}] request completed:`, {
      requestId,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
};

export const logVoiceCallRequests = createRequestLogger("VoiceCall");
export const logSpeechTranscriptionRequests = createRequestLogger("SpeechTranscription");
