import { Schema, model, type HydratedDocument } from "mongoose";
import type { IMessage, InputType, Language, OutputType, Role } from "../types/common.types";




export type MessageDocument = HydratedDocument<IMessage>;

const ROLE_VALUES: Role[] = ["user",  "assistant",];

const INPUT_TYPE_VALUES: InputType[] = ["text", "voice","image"];

const OUTPUT_TYPE_VALUES: OutputType[] = ["text","voice","image",
];

const LANGUAGE_VALUES: Language[] = ["en","hi", "mr",];

const messageSchema = new Schema<IMessage>({

    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: [true,"Conversation ID is required."],
      index: true,
    },

    role: {
      type: String,
      enum: {
        values: ROLE_VALUES,
        message:"Role must be either user or assistant.",
      },
      required: [ true,"Message role is required."],
      index: true,
    },

    inputType: {
      type: String,
      enum: {
        values: INPUT_TYPE_VALUES,
        message: "Input type must be one of: text, voice, image.",
      },
      default: undefined,
    },

    outputType: {
      type: String,
      enum: {
        values: OUTPUT_TYPE_VALUES,
        message: "Output type must be one of: text, voice, image.",
      },
      default: undefined,
    },

    /**
     * Always store text.
     *
     * Voice → transcript
     * Image → prompt/OCR/description
     * Assistant → generated response
     */
    contentText: {
      type: String,
      required: [
        true,"Message content is required.",
      ],

      trim: true,
    },

    fileUrl: {
      type: String,
      default: null,
      trim: true,
    },

    responseLanguage: {
      type: String,
      enum: {
        values: LANGUAGE_VALUES,
        message: "Response language must be one of: en, hi, mr.",
      },
      default: null,
    },

    languageOverride: {
      type: Boolean,
      default: false,
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


messageSchema.index({  conversationId: 1,createdAt: 1});

messageSchema.index({  conversationId: 1,  role: 1,createdAt: 1});
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });


messageSchema.pre("validate", function () {
    if (this.role === "user") {
    if (!this.inputType) {
      throw new Error("Input type is required for user messages.");
    }

    if (this.outputType) {
      throw new Error("Output type cannot be set for user messages.");
    }
  }


  if (this.role === "assistant") {
    if (!this.outputType) {
      throw new Error("Output type is required for assistant messages.");
    }

    if (this.inputType) {
      throw new Error("Input type cannot be set for assistant messages.");
    }
  }
});

export const MessageModel = model<IMessage>( "Message",  messageSchema);
