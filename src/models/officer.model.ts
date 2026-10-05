import { Schema, model, type HydratedDocument, type Types } from "mongoose";

export interface IOfficer {
  name: string;
  title: string;
  departmentId: Types.ObjectId;
  email: string;
  phone: string;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OfficerDocument = HydratedDocument<IOfficer>;

const officerSchema = new Schema<IOfficer>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true, index: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
    phone: { type: String, trim: true, maxlength: 30, default: "" },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, versionKey: false },
);

officerSchema.index({ active: 1, departmentId: 1, name: 1 });
officerSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string", $gt: "" } } });

export const OfficerModel = model<IOfficer>("Officer", officerSchema);
