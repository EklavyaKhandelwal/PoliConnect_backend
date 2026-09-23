
import {  Schema, model, type HydratedDocument} from "mongoose";
import type { IConversation, Language } from "../types/common.types";


export type ConversationDocument =HydratedDocument<IConversation>;

const LANGUAGE_VALUES: Language[] = ["en","hi","mr",];

const conversationSchema =  new Schema<IConversation>(
    {
      sessionId: {
        type: Schema.Types.ObjectId,
        ref: "Session",
        required: [true, "Session ID is required."],
        index: true,
      },

      title: {
        type: String,
        trim: true,
        maxLength: [ 200,  "Conversation title cannot exceed 200 characters.",],
        default: "New Conversation",
      },

      responseLanguage: {
        type: String,
        enum: {
          values: LANGUAGE_VALUES,
          message: "Response language must be one of: en, hi, mr.",
        },

        required: [
          true,
          "Response language is required.",
        ],

        default: "en",
      },
      expiresAt: {
        type: Date,
        default: null,
      },
    },
    {
      timestamps: true,
      versionKey: false,
    },
  );

conversationSchema.index({sessionId: 1, updatedAt: -1,});
conversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ConversationModel = model<IConversation>("Conversation", conversationSchema,);
