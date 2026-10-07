import { Router } from "express";
import { respondToVoiceCall } from "../controllers/voiceCall.controller";
import { sessionMiddleware } from "../middleware/session.middleware";
import { logVoiceCallRequests } from "../middleware/voiceCallErrorLog.middleware";
import { aiRequestRateLimit } from "../middleware/aiRateLimit.middleware";

const voiceCallRouter = Router();

voiceCallRouter.use(logVoiceCallRequests);
voiceCallRouter.post("/respond", sessionMiddleware, aiRequestRateLimit, respondToVoiceCall);

export default voiceCallRouter;
