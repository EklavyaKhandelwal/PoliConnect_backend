import {Schema,model, type HydratedDocument} from "mongoose";
import type { IUser } from "../types/common.types";


export type UserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
    },

    name: {
      type: String,
      trim: true,
      maxLength: [100, "Name cannot exceed 100 characters."],
    },

    password: {
      type: String,
      required: [true, "Password is required."],
      minLength: [6, "Password must be at least 6 characters long."],
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const UserModel = model<IUser>("User",userSchema);