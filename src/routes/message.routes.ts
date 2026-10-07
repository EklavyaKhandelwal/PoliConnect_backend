import { Router } from "express";
import {
  deleteMessage,
  getMessages,
  sendMessage,
  speakMessage,
  translateMessage,
  transcribeMessage,
} from "../controllers/message.controller";
import { sessionMiddleware } from "../middleware/session.middleware";
import { upload } from "../middleware/upload.middleware";
import { logSpeechTranscriptionRequests } from "../middleware/voiceCallErrorLog.middleware";
import { aiRequestRateLimit } from "../middleware/aiRateLimit.middleware";

const messageRouter = Router();

messageRouter.post("/conversations/:conversationId/messages", sessionMiddleware, aiRequestRateLimit, upload.single("file"), sendMessage);
messageRouter.post(
  "/transcribe",
  logSpeechTranscriptionRequests,
  sessionMiddleware,
  aiRequestRateLimit,
  upload.single("file"),
  transcribeMessage,
);
messageRouter.post("/:messageId/speak", sessionMiddleware, aiRequestRateLimit, speakMessage);
messageRouter.post("/:messageId/translate", sessionMiddleware, aiRequestRateLimit, translateMessage);
messageRouter.get("/conversations/:conversationId/messages", sessionMiddleware, getMessages);
messageRouter.delete("/conversations/:conversationId/messages/:messageId", sessionMiddleware, deleteMessage);

export default messageRouter;