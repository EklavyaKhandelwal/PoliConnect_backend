import { Router } from "express";
import { createSuggestion, listMySuggestions } from "../controllers/suggestion.controller";
import { sessionMiddleware } from "../middleware/session.middleware";

const suggestionRouter = Router();

suggestionRouter.get("/", sessionMiddleware, listMySuggestions);
suggestionRouter.post("/", sessionMiddleware, createSuggestion);

export default suggestionRouter;
