import { ConversationModel, type ConversationDocument } from "../models/conversation.model";
import type { Types } from "mongoose";
import type { IConversation } from "../types/common.types";

class ConversationRepository {
  async create(data: IConversation): Promise<ConversationDocument> {
    return ConversationModel.create(data);
  }

  async findById(conversationId: Types.ObjectId): Promise<ConversationDocument | null> {
    return ConversationModel.findById(conversationId).exec();
  }


  async findByIdAndSessionId(conversationId: Types.ObjectId, sessionId: Types.ObjectId): Promise<ConversationDocument | null> {
    return ConversationModel.findOne({ _id: conversationId, sessionId }).exec();
  }

  async findBySessionId(sessionId: Types.ObjectId): Promise<ConversationDocument[]> {
    return ConversationModel.find({ sessionId })
      .sort({ updatedAt: -1 })
      .exec();
  }

  async findLatestBySessionId(sessionId: Types.ObjectId): Promise<ConversationDocument | null> {
    return ConversationModel.findOne({ sessionId })
      .sort({ updatedAt: -1 })
      .exec();
  }

  async updateById(conversationId: Types.ObjectId, data: Partial<IConversation>): Promise<ConversationDocument | null> {
    return ConversationModel.findByIdAndUpdate(conversationId, data, {
      returnDocument: "after",
      runValidators: true,
    }).exec();
  }

  async updateByIdAndSessionId(
    conversationId: Types.ObjectId,
    sessionId: Types.ObjectId,
    data: Partial<IConversation>
  ): Promise<ConversationDocument | null> {
    return ConversationModel.findOneAndUpdate({ _id: conversationId, sessionId }, data, {
      returnDocument: "after",
      runValidators: true,
    }).exec();
  }

  async deleteById(conversationId: Types.ObjectId): Promise<ConversationDocument | null> {
    return ConversationModel.findByIdAndDelete(conversationId).exec();
  }

  async deleteByIdAndSessionId(conversationId: Types.ObjectId, sessionId: Types.ObjectId): Promise<ConversationDocument | null> {
    return ConversationModel.findOneAndDelete({ _id: conversationId, sessionId }).exec();
  }

  async existsById(conversationId: Types.ObjectId): Promise<boolean> {
    const conversation = await ConversationModel.exists({ _id: conversationId });
    return conversation !== null;
  }
}

export const conversationRepository = new ConversationRepository();