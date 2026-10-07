import { Schema, model, type Types } from "mongoose";

export type RecoveryScope = "citizen" | "admin";

export interface IPasswordRecovery {
  userId: Types.ObjectId;
  scope: RecoveryScope;
  codeHash: string;
  codeExpiresAt: Date;
  attempts: number;
  requestWindowStartedAt: Date;
  requestCount: number;
  lastSentAt: Date;
  deleteAfter: Date;
}

const passwordRecoverySchema = new Schema<IPasswordRecovery>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    scope: { type: String, enum: ["citizen", "admin"], required: true },
    codeHash: { type: String, required: true },
    codeExpiresAt: { type: Date, required: true },
    attempts: { type: Number, required: true, default: 0 },
    requestWindowStartedAt: { type: Date, required: true },
    requestCount: { type: Number, required: true, default: 0 },
    lastSentAt: { type: Date, required: true },
    deleteAfter: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);

passwordRecoverySchema.index({ userId: 1, scope: 1 }, { unique: true });
passwordRecoverySchema.index({ deleteAfter: 1 }, { expireAfterSeconds: 0 });

export const PasswordRecoveryModel = model<IPasswordRecovery>(
  "PasswordRecovery",
  passwordRecoverySchema,
);
