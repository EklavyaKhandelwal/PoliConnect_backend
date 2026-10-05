import { Schema, model, type HydratedDocument, type Types } from "mongoose";

export const SUGGESTION_TYPES = ["suggestion", "thanks", "question"] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];

export interface ISuggestionAdminReply {
  message: string;
  repliedBy: string;
  createdAt: Date;
}

export interface ISuggestion {
  referenceNumber: string;
  type: SuggestionType;
  message: string;
  keepNamePrivate: boolean;
  status: "received" | "read";
  readAt?: Date | null;
  readBy?: string | null;
  isHighlighted: boolean;
  highlightedAt?: Date | null;
  highlightedBy?: string | null;
  adminReplies: ISuggestionAdminReply[];
  sessionId: Types.ObjectId;
  userId: Types.ObjectId | null;
  guestId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SuggestionDocument = HydratedDocument<ISuggestion>;

const suggestionSchema = new Schema<ISuggestion>(
  {
    referenceNumber: { type: String, required: true, unique: true },
    type: { type: String, enum: SUGGESTION_TYPES, required: true },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    keepNamePrivate: { type: Boolean, required: true, default: false },
    status: { type: String, enum: ["received", "read"], required: true, default: "received", index: true },
    readAt: { type: Date, default: null },
    readBy: { type: String, trim: true, maxlength: 100, default: null },
    isHighlighted: { type: Boolean, default: false, index: true },
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
    sessionId: { type: Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    guestId: { type: String, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

suggestionSchema.index({ sessionId: 1, createdAt: -1 });
suggestionSchema.index({ status: 1, type: 1, createdAt: -1 });

export const SuggestionModel = model<ISuggestion>("Suggestion", suggestionSchema);
