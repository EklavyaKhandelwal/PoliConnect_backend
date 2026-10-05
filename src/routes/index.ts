

import { Router } from "express";
import sessionRouter from "./session.routes";
import userRouter from "./user.routes";
import conversationRouter from "./conversation.routes";
import messageRouter from "./message.routes";
import complaintRouter from "./complaint.routes";
import suggestionRouter from "./suggestion.routes";
import voiceCallRouter from "./voiceCall.routes";
import adminRouter from "./admin.routes";

const router = Router();

router.use("/session", sessionRouter);
router.use("/user", userRouter);
router.use("/conversation", conversationRouter);
router.use("/message", messageRouter);
router.use("/complaints", complaintRouter);
router.use("/suggestions", suggestionRouter);
router.use("/voice-call", voiceCallRouter);
router.use("/admin", adminRouter);

export default router;