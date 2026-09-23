

import { Router } from "express";
import { createSession, deleteSession } from "../controllers/session.controller";


const sessionRouter = Router();


sessionRouter.post("/",  createSession)
sessionRouter.delete("/:sessionId",deleteSession);


export default sessionRouter;






















