
import { Schema, model, type HydratedDocument } from "mongoose";
import type { ISession } from "../types/common.types";

export type SessionDocument = HydratedDocument<ISession>;



const sessionSchema = new Schema<ISession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    guestId: {
      type: String,
      default: null,
      trim: true,
      minLength: [1, "Guest ID cannot be empty."],
    },
  },
  { timestamps: true, versionKey: false },
);

sessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400, partialFilterExpression: { guestId: { $type: "string" } } });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ guestId: 1 });

sessionSchema.pre("validate", function (this: SessionDocument) {
  const hasUser = Boolean(this.userId);
  const hasGuest = Boolean(this.guestId);

  if (!hasUser && !hasGuest) {
    throw new Error("Session must have either a user ID or a guest ID.");
  }

  if (hasUser && hasGuest) {
    throw new Error("Session cannot have both a user ID and a guest ID.");
  }
});

export const SessionModel = model<ISession>("Session", sessionSchema);
