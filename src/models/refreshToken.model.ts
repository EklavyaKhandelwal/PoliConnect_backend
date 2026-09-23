import { Schema, model, type HydratedDocument, type Types } from "mongoose";

export interface IRefreshToken {
  _id?: Types.ObjectId;
  tokenHash: string;
  userId: Types.ObjectId;
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
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenHash: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<IRefreshToken>("RefreshToken", refreshTokenSchema);
