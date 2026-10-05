import { Schema, model, type HydratedDocument, type Types } from "mongoose";

export interface IRefreshToken {
  _id?: Types.ObjectId;
  tokenHash: string;
  userId: Types.ObjectId;
  purpose?: "citizen" | "admin";
  adminSessionId?: string | null;
  expiresAt: Date;
  revokedAt?: Date | null;
  replacedByTokenHash?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type RefreshTokenDocument = HydratedDocument<IRefreshToken>;

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: ["citizen", "admin"], default: "citizen", required: true },
    adminSessionId: { type: String, default: null, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenHash: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ adminSessionId: 1, purpose: 1, revokedAt: 1, expiresAt: 1 });

export const RefreshTokenModel = model<IRefreshToken>("RefreshToken", refreshTokenSchema);
