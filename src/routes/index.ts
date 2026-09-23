

import { Router } from "express";
import sessionRouter from "./session.routes";
import userRouter from "./user.routes";
import conversationRouter from "./conversation.routes";
import messageRouter from "./message.routes";

const router = Router();

router.use("/session", sessionRouter);
router.use("/user", userRouter);
router.use("/conversation", conversationRouter);
router.use("/message", messageRouter);

export default router;