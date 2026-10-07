

import { Router } from "express";
import { deleteAccount, getMe, login, logout, refresh, signup } from "../controllers/user.controller";
import { sessionMiddleware } from "../middleware/session.middleware";
import { requestPasswordRecovery, resetPassword } from "../controllers/passwordRecovery.controller";
import {
  loginRateLimit,
  recoveryRequestRateLimit,
  recoveryResetRateLimit,
} from "../middleware/authRateLimit.middleware";

const userRouter = Router();

userRouter.post("/signup", loginRateLimit, sessionMiddleware, signup);
userRouter.post("/login", loginRateLimit, sessionMiddleware, login);
userRouter.post("/forgot-password", recoveryRequestRateLimit, requestPasswordRecovery("citizen"));
userRouter.post("/reset-password", recoveryResetRateLimit, resetPassword("citizen"));
userRouter.post("/logout", logout);
userRouter.post("/refresh", refresh);
userRouter.get("/me", sessionMiddleware, getMe);
userRouter.delete("/me", sessionMiddleware, deleteAccount);



export default userRouter;