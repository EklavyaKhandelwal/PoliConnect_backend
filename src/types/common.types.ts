import { Types } from "mongoose";

export type InputType = "text" | "voice" | "image";

export type OutputType = "text" | "voice" | "image";

export type Role = "user" | "assistant";

export type Language = "en" | "hi" | "mr";

export type ProviderName =
  | "anthropic"
  | "openai"
  | "groq";


export interface IUser {
  _id?: Types.ObjectId;
  email: string;
  name?: string;
  password: string;
  createdAt?: Date;
  updatedAt?: Date;
}


export interface ISession {
  _id?: Types.ObjectId;
  userId?: Types.ObjectId | null;
  guestId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  expiresAt?: Date;
}


export interface IConversation {
  _id?: Types.ObjectId;
  sessionId: Types.ObjectId;
  title?: string;
  responseLanguage: Language;
  createdAt?: Date;
  updatedAt?: Date;
  expiresAt?: Date;
}


export interface IMessage {
  _id?: Types.ObjectId;
  conversationId: Types.ObjectId;
  role: Role;
  inputType?: InputType;
  outputType?: OutputType;
  contentText: string;
  fileUrl?: string | null;
  responseLanguage?: Language | null;
  languageOverride: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  expiresAt?: Date;
}


export interface CreateMessageInput {
  conversationId: string;
  role: Role;
  inputType?: InputType;
  outputType?: OutputType;
  contentText: string;
  fileUrl?: string | null;
  responseLanguage?: Language | null;
  languageOverride?: boolean;
}


export interface ContextMessage {
  role: Role;
  content: string;
}