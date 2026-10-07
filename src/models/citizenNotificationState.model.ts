import { Schema, model } from "mongoose";

export interface ICitizenNotificationState {
  recipientKey: string;
  readIds: string[];
  readThroughAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const citizenNotificationStateSchema = new Schema<ICitizenNotificationState>(
  {
    recipientKey: { type: String, required: true, unique: true },
    readIds: { type: [String], default: [] },
    readThroughAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const CitizenNotificationStateModel = model<ICitizenNotificationState>(
  "CitizenNotificationState",
  citizenNotificationStateSchema,
);
