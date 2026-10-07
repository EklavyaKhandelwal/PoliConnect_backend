import { Router } from "express";
import {
  adminLogin,
  adminLogout,
  adminRefresh,
  createAdminAccount,
  getAdminProfile,
} from "../controllers/admin.controller";
import {
  createDepartment,
  createOfficer,
  createReplyTemplate,
  listDepartments,
  listOfficers,
  listReplyTemplates,
  updateDepartment,
  updateOfficer,
  updateReplyTemplate,
} from "../controllers/adminCatalog.controller";
import {
  getAdminComplaint,
  updateAdminComplaint,
} from "../controllers/adminComplaintActions.controller";
import { getAdminOverview } from "../controllers/adminAnalytics.controller";
import { getAdminSettings, updateAdminSettings } from "../controllers/adminSettings.controller";
import { getAdminNotifications } from "../controllers/adminNotifications.controller";
import { getAdminNotificationState, markAdminNotificationsRead } from "../controllers/adminNotificationState.controller";
import {
  listAdminComplaintFeedback,
  listAdminSuggestions,
  updateAdminComplaintFeedback,
  updateAdminSuggestion,
} from "../controllers/adminSuggestions.controller";
import { listAdminComplaints } from "../controllers/adminComplaints.controller";
import { adminAuthMiddleware, ownerOnlyMiddleware } from "../middleware/adminAuth.middleware";
import { uploadComplaintPhotos } from "../middleware/complaintPhotos.middleware";
import { requestPasswordRecovery, resetPassword } from "../controllers/passwordRecovery.controller";
import {
  loginRateLimit,
  recoveryRequestRateLimit,
  recoveryResetRateLimit,
} from "../middleware/authRateLimit.middleware";

const adminRouter = Router();

adminRouter.post("/login", loginRateLimit, adminLogin);
adminRouter.post("/forgot-password", recoveryRequestRateLimit, requestPasswordRecovery("admin"));
adminRouter.post("/reset-password", recoveryResetRateLimit, resetPassword("admin"));
adminRouter.post("/refresh", adminRefresh);
adminRouter.post("/logout", adminLogout);
adminRouter.get("/me", adminAuthMiddleware, getAdminProfile);
adminRouter.post("/users", adminAuthMiddleware, ownerOnlyMiddleware, createAdminAccount);
adminRouter.get("/analytics/overview", adminAuthMiddleware, getAdminOverview);
adminRouter.get("/settings", adminAuthMiddleware, getAdminSettings);
adminRouter.put("/settings", adminAuthMiddleware, ownerOnlyMiddleware, updateAdminSettings);
adminRouter.get("/notifications", adminAuthMiddleware, getAdminNotifications);
adminRouter.get("/notifications/read-state", adminAuthMiddleware, getAdminNotificationState);
adminRouter.patch("/notifications/read-state", adminAuthMiddleware, markAdminNotificationsRead);
adminRouter.get("/suggestions", adminAuthMiddleware, listAdminSuggestions);
adminRouter.patch("/suggestions/:referenceNumber", adminAuthMiddleware, updateAdminSuggestion);
adminRouter.get("/feedback", adminAuthMiddleware, listAdminComplaintFeedback);
adminRouter.patch("/feedback/:complaintNumber", adminAuthMiddleware, updateAdminComplaintFeedback);
adminRouter.get("/complaints", adminAuthMiddleware, listAdminComplaints);
adminRouter.get("/complaints/:complaintNumber", adminAuthMiddleware, getAdminComplaint);
adminRouter.patch("/complaints/:complaintNumber", adminAuthMiddleware, uploadComplaintPhotos, updateAdminComplaint);
adminRouter.get("/departments", adminAuthMiddleware, listDepartments);
adminRouter.post("/departments", adminAuthMiddleware, ownerOnlyMiddleware, createDepartment);
adminRouter.patch("/departments/:id", adminAuthMiddleware, ownerOnlyMiddleware, updateDepartment);
adminRouter.get("/officers", adminAuthMiddleware, listOfficers);
adminRouter.post("/officers", adminAuthMiddleware, ownerOnlyMiddleware, createOfficer);
adminRouter.patch("/officers/:id", adminAuthMiddleware, ownerOnlyMiddleware, updateOfficer);
adminRouter.get("/reply-templates", adminAuthMiddleware, listReplyTemplates);
adminRouter.post("/reply-templates", adminAuthMiddleware, ownerOnlyMiddleware, createReplyTemplate);
adminRouter.patch("/reply-templates/:id", adminAuthMiddleware, ownerOnlyMiddleware, updateReplyTemplate);

export default adminRouter;
