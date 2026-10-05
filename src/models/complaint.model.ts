import { Schema, model, type HydratedDocument, type Types } from "mongoose";

export const COMPLAINT_CATEGORIES = [
  "road",
  "water",
  "electricity",
  "cleanliness",
  "health",
  "ration",
  "education",
  "other",
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export const COMPLAINT_STATUSES = [
  "received",
  "under_review",
  "in_progress",
  "waiting_for_citizen",
  "resolved",
  "rejected",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export type CitizenConfirmation = "resolved" | "not_resolved";
export type ComplaintActivityType =
  | "registered"
  | "assigned"
  | "status_changed"
  | "resolved"
  | "rejected"
  | "citizen_reply"
  | "citizen_reopened";

export interface IComplaintStatusUpdate {
  status: ComplaintStatus;
  message?: string;
  updatedBy?: string;
  photos?: string[];
  createdAt: Date;
}

export interface IComplaintMessage {
  sender: "admin" | "citizen";
  senderName?: string;
  message: string;
  photos: string[];
  requiresResponse: boolean;
  readAt?: Date;
  createdAt: Date;
}

export interface IComplaintActivity {
  type: ComplaintActivityType;
  status?: ComplaintStatus;
  message?: string;
  updatedBy?: string;
  createdAt: Date;
}

export interface IComplaintInternalNote {
  message: string;
  createdBy: string;
  createdAt: Date;
}

export interface IComplaintFeedback {
  confirmation: CitizenConfirmation;
  rating?: number;
  tags: string[];
  comment: string;
  submittedAt: Date;
  adminReadAt?: Date | null;
  adminReadBy?: string | null;
  isHighlighted?: boolean;
  highlightedAt?: Date | null;
  highlightedBy?: string | null;
  adminReplies?: Array<{
    message: string;
    repliedBy: string;
    createdAt: Date;
  }>;
}

export interface IComplaint {
  complaintNumber: string;
  idempotencyKey?: string;
  category: ComplaintCategory;
  details: string;
  photos: string[];
  location: {
    latitude?: number;
    longitude?: number;
    area?: string;
  };
  contact: {
    name: string;
    phone: string;
    privateName: boolean;
  };
  status: ComplaintStatus;
  assignedDepartmentId?: Types.ObjectId | null;
  assignedOfficerId?: Types.ObjectId | null;
  slaStartedAt?: Date | null;
  slaDeadline?: Date | null;
  slaPausedAt?: Date | null;
  statusHistory: IComplaintStatusUpdate[];
  activityHistory: IComplaintActivity[];
  publicMessages: IComplaintMessage[];
  internalNotes: IComplaintInternalNote[];
  citizenFeedback?: IComplaintFeedback;
  userId: Types.ObjectId | null;
  guestId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ComplaintDocument = HydratedDocument<IComplaint>;

const complaintSchema = new Schema<IComplaint>(
  {
    complaintNumber: {
      type: String,
      required: true,
      unique: true,
    },
      idempotencyKey: {
        type: String,
        trim: true,
        maxlength: 100,
        select: false,
      },
      category: {
      type: String,
      enum: COMPLAINT_CATEGORIES,
      required: true,
    },
    details: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    photos: {
      type: [String],
      default: [],
      validate: [(photos: string[]) => photos.length <= 4, "No more than 4 photos are allowed."],
    },
    location: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
      area: { type: String, trim: true, maxlength: 150 },
    },
    contact: {
      name: { type: String, trim: true, maxlength: 100, default: "" },
      phone: { type: String, required: true },
      privateName: { type: Boolean, required: true, default: false },
    },
    status: {
      type: String,
      enum: COMPLAINT_STATUSES,
      required: true,
      default: "received",
    },
    assignedDepartmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    assignedOfficerId: { type: Schema.Types.ObjectId, ref: "Officer", default: null, index: true },
    slaStartedAt: { type: Date, default: null },
    slaDeadline: { type: Date, default: null, index: true },
    slaPausedAt: { type: Date, default: null },
    statusHistory: {
      type: [{
        status: {
          type: String,
          enum: COMPLAINT_STATUSES,
          required: true,
        },
        message: { type: String, trim: true, maxlength: 1000 },
        updatedBy: { type: String, trim: true, maxlength: 100 },
        photos: { type: [String], default: [] },
        createdAt: { type: Date, required: true, default: Date.now },
      }],
      default: [],
    },
    activityHistory: {
      type: [{
        type: {
          type: String,
          enum: ["registered", "assigned", "status_changed", "resolved", "rejected", "citizen_reply", "citizen_reopened"],
          required: true,
        },
        status: { type: String, enum: COMPLAINT_STATUSES },
        message: { type: String, trim: true, maxlength: 1000 },
        updatedBy: { type: String, trim: true, maxlength: 100 },
        createdAt: { type: Date, required: true, default: Date.now },
      }],
      default: [],
    },
    publicMessages: {
      type: [{
        sender: { type: String, enum: ["admin", "citizen"], required: true },
        senderName: { type: String, trim: true, maxlength: 100 },
        message: { type: String, trim: true, maxlength: 1000 },
        photos: { type: [String], default: [] },
        requiresResponse: { type: Boolean, default: false },
        readAt: { type: Date, default: null },
        createdAt: { type: Date, required: true, default: Date.now },
      }],
      default: [],
    },
    internalNotes: {
      type: [{
        message: { type: String, trim: true, maxlength: 1000, required: true },
        createdBy: { type: String, trim: true, maxlength: 100 },
        createdAt: { type: Date, required: true, default: Date.now },
      }],
      default: [],
    },
    citizenFeedback: {
      confirmation: { type: String, enum: ["resolved", "not_resolved"] },
      rating: { type: Number, min: 1, max: 5 },
      tags: { type: [String], default: [] },
      comment: { type: String, trim: true, maxlength: 1000, default: "" },
      submittedAt: { type: Date },
      adminReadAt: { type: Date, default: null },
      adminReadBy: { type: String, trim: true, maxlength: 100, default: null },
      isHighlighted: { type: Boolean, default: false },
      highlightedAt: { type: Date, default: null },
      highlightedBy: { type: String, trim: true, maxlength: 100, default: null },
      adminReplies: {
        type: [{
          message: { type: String, required: true, trim: true, maxlength: 1000 },
          repliedBy: { type: String, required: true, trim: true, maxlength: 100 },
          createdAt: { type: Date, required: true, default: Date.now },
        }],
        default: [],
      },
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    guestId: { type: String, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

complaintSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: { $type: "objectId" },
      idempotencyKey: { $type: "string" },
    },
  },
);
complaintSchema.index(
  { guestId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      guestId: { $type: "string" },
      idempotencyKey: { $type: "string" },
    },
  },
);
complaintSchema.index({ status: 1, createdAt: -1 });
complaintSchema.index({ category: 1, status: 1, createdAt: -1 });
complaintSchema.index({ "location.area": 1, status: 1, createdAt: -1 });

export const ComplaintModel = model<IComplaint>("Complaint", complaintSchema);
