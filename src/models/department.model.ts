import { Schema, model, type HydratedDocument } from "mongoose";

export interface IDepartment {
  name: string;
  code: string;
  description: string;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DepartmentDocument = HydratedDocument<IDepartment>;

const departmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20, unique: true },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, versionKey: false },
);

departmentSchema.index({ active: 1, name: 1 });

export const DepartmentModel = model<IDepartment>("Department", departmentSchema);
