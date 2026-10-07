import { Schema, model, Types } from "mongoose";

export interface IAdminNotificationState {
  adminId: Types.ObjectId;
  readIds: string[];
  readThroughAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const adminNotificationStateSchema = new Schema<IAdminNotificationState>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    readIds: { type: [String], default: [] },
    readThroughAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const AdminNotificationStateModel = model<IAdminNotificationState>(
  "AdminNotificationState",
  adminNotificationStateSchema,
);
