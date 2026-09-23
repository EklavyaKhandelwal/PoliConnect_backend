

import { Router } from "express";
import {  deleteConversation, getConversation, getConversations, updateConversation } from "../controllers/conversation.controller";
import { sessionMiddleware } from "../middleware/session.middleware";

const conversationRouter = Router();



conversationRouter.get("/", sessionMiddleware, getConversations);
conversationRouter.get("/:conversationId", sessionMiddleware, getConversation);
conversationRouter.patch("/:conversationId", sessionMiddleware, updateConversation);
conversationRouter.delete("/:conversationId", sessionMiddleware, deleteConversation);



export default conversationRouter;