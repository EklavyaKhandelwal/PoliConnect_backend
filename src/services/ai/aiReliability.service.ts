interface ProviderFailure {
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
}

export class AiServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AiServiceError";
  }
}

const classifyFailure = (error: unknown): AiServiceError => {
  const failure = error as ProviderFailure;
  const status = typeof failure?.status === "number"
    ? failure.status
    : typeof failure?.statusCode === "number"
      ? failure.statusCode
      : undefined;
  const code = typeof failure?.code === "string" ? failure.code : "";
  const name = typeof failure?.name === "string" ? failure.name : "";

  if (status === 413 || code === "tokens_per_minute") {
    return new AiServiceError(
      "This request is too large to process. Please try a shorter message.",
      413,
      "AI_REQUEST_TOO_LARGE",
    );
  }
  if (status === 429 || code.toLowerCase().includes("rate_limit")) {
    return new AiServiceError(
      "The assistant is busy right now. Please try again shortly.",
      429,
      "AI_RATE_LIMITED",
    );
  }
  if (
    name.toLowerCase().includes("timeout") ||
    code.toLowerCase().includes("timeout") ||
    code === "ETIMEDOUT" ||
    name === "AbortError"
  ) {
    return new AiServiceError(
      "The assistant took too long to respond. Please try again.",
      503,
      "AI_TIMEOUT",
    );
  }
  return new AiServiceError(
    "The AI service is temporarily unavailable. Please try again.",
    503,
    "AI_UNAVAILABLE",
  );
};

export async function runAiOperation<T>(
  operation: string,
  run: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const operationPromise = run();
    const result = timeoutMs
      ? await Promise.race([
          operationPromise,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              const error = new Error("AI operation timed out.");
              Object.assign(error, { name: "TimeoutError", code: "ETIMEDOUT" });
              reject(error);
            }, timeoutMs);
          }),
        ])
      : await operationPromise;
    console.info("[AI] operation completed", {
      operation,
      durationMs: Date.now() - startedAt,
      outcome: "success",
    });
    return result;
  } catch (error) {
    const safeError = classifyFailure(error);
    console.warn("[AI] operation failed", {
      operation,
      durationMs: Date.now() - startedAt,
      outcome: "failure",
      status: safeError.status,
      code: safeError.code,
    });
    throw safeError;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
