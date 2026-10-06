import { Schema, model } from "mongoose";
import { COMPLAINT_CATEGORIES, type ComplaintActivityType, type ComplaintCategory } from "./complaint.model";

export interface IAdminSettingsProfile {
  organizationName: string;
  officeName: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
}

export type AdminNotificationPreferences = Record<ComplaintActivityType, boolean>;

export interface IAdminSettings {
  scope: string;
  profile: IAdminSettingsProfile;
  slaWorkingDays: Record<ComplaintCategory, number>;
  notifications: AdminNotificationPreferences;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DEFAULT_SLA_WORKING_DAYS: Record<ComplaintCategory, number> = {
  road: 5,
  water: 5,
  electricity: 5,
  cleanliness: 5,
  health: 5,
  ration: 5,
  education: 5,
  other: 5,
};

export const DEFAULT_NOTIFICATION_PREFERENCES: AdminNotificationPreferences = {
  registered: true,
  assigned: true,
  status_changed: true,
  resolved: true,
  rejected: true,
  citizen_reply: true,
  citizen_reopened: true,
};

export const DEFAULT_ADMIN_SETTINGS: Omit<IAdminSettings, "scope"> = {
  profile: {
    organizationName: "",
    officeName: "",
    address: "",
    contactEmail: "",
    contactPhone: "",
  },
  slaWorkingDays: DEFAULT_SLA_WORKING_DAYS,
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
};

const categorySlaSchema = Object.fromEntries(
  COMPLAINT_CATEGORIES.map((category) => [
    category,
    { type: Number, required: true, default: DEFAULT_SLA_WORKING_DAYS[category], min: 1, max: 60 },
  ]),
);

const notificationSchema = {
  registered: { type: Boolean, required: true, default: true },
  assigned: { type: Boolean, required: true, default: true },
  status_changed: { type: Boolean, required: true, default: true },
  resolved: { type: Boolean, required: true, default: true },
  rejected: { type: Boolean, required: true, default: true },
  citizen_reply: { type: Boolean, required: true, default: true },
  citizen_reopened: { type: Boolean, required: true, default: true },
};

const adminSettingsSchema = new Schema<IAdminSettings>(
  {
    scope: { type: String, required: true, unique: true, default: "global", immutable: true },
    profile: {
      organizationName: { type: String, trim: true, maxlength: 100, default: "" },
      officeName: { type: String, trim: true, maxlength: 100, default: "" },
      address: { type: String, trim: true, maxlength: 250, default: "" },
      contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
      contactPhone: { type: String, trim: true, maxlength: 30, default: "" },
    },
    slaWorkingDays: categorySlaSchema,
    notifications: notificationSchema,
  },
  { timestamps: true, versionKey: false },
);

export const AdminSettingsModel = model<IAdminSettings>("AdminSettings", adminSettingsSchema);
