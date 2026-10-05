import { Schema, model, type HydratedDocument } from "mongoose";

export const REPLY_TEMPLATE_LANGUAGES = ["en", "hi", "mr"] as const;
export type ReplyTemplateLanguage = (typeof REPLY_TEMPLATE_LANGUAGES)[number];

export interface IReplyTemplate {
  title: string;
  message: string;
  language: ReplyTemplateLanguage;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ReplyTemplateDocument = HydratedDocument<IReplyTemplate>;

const replyTemplateSchema = new Schema<IReplyTemplate>(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    language: { type: String, enum: REPLY_TEMPLATE_LANGUAGES, required: true },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, versionKey: false },
);

replyTemplateSchema.index({ active: 1, language: 1, updatedAt: -1 });

export const ReplyTemplateModel = model<IReplyTemplate>("ReplyTemplate", replyTemplateSchema);
