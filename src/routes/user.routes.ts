

import { Router } from "express";
import { deleteAccount, getMe, login, logout, refresh, signup } from "../controllers/user.controller";
import { sessionMiddleware } from "../middleware/session.middleware";

const userRouter = Router();

userRouter.post("/signup", sessionMiddleware, signup);
userRouter.post("/login", sessionMiddleware, login);
userRouter.post("/logout", logout);
userRouter.post("/refresh", refresh);
userRouter.get("/me", sessionMiddleware, getMe);
userRouter.delete("/me", sessionMiddleware, deleteAccount);



export default userRouter;