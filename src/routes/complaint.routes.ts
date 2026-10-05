import { Router } from "express";
import {
  createComplaint,
  getComplaint,
  listComplaints,
  sendComplaintMessage,
  submitComplaintFeedback,
} from "../controllers/complaint.controller";
import { uploadComplaintPhotos } from "../middleware/complaintPhotos.middleware";
import { sessionMiddleware } from "../middleware/session.middleware";

const complaintRouter = Router();

complaintRouter.get("/", sessionMiddleware, listComplaints);
complaintRouter.get("/:complaintNumber", sessionMiddleware, getComplaint);
complaintRouter.patch("/:complaintNumber/feedback", sessionMiddleware, submitComplaintFeedback);
complaintRouter.post("/:complaintNumber/messages", sessionMiddleware, uploadComplaintPhotos, sendComplaintMessage);
complaintRouter.post("/", sessionMiddleware, uploadComplaintPhotos, createComplaint);

export default complaintRouter;
