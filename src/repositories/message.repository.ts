
import {MessageModel, type MessageDocument} from "../models/message.model";

import type { Types } from "mongoose";
import type { IMessage, Role } from "../types/common.types";

 class MessageRepository {
  async create( data: IMessage  ): Promise<MessageDocument> {
    return MessageModel.create(data);

  }

  async findById( messageId: Types.ObjectId): Promise<MessageDocument | null> {
    return MessageModel.findById( messageId).exec();
  }

  async findByConversationId( conversationId: Types.ObjectId): Promise<MessageDocument[]> {

    return MessageModel.find({ conversationId })
      .sort({ createdAt: 1 })
      .exec();
  }

  async findByConversationIdAndRole(    conversationId: Types.ObjectId,  role: Role): Promise<MessageDocument[]> {

    return MessageModel.find({
      conversationId,
      role,
    })
      .sort({ createdAt: 1 })
      .exec();
  }

  async findLatestByConversationId( conversationId: Types.ObjectId): Promise<MessageDocument | null> {
  
    return MessageModel.findOne({
      conversationId,
    })
      .sort({ createdAt: -1 })
      .exec();
  }
  async findByContextWindow( conversationId: Types.ObjectId, contextWindow?: number ): Promise<MessageDocument[]> {


     const query = MessageModel.find({
       conversationId,
     }).sort({ createdAt: -1 });

    if (contextWindow !== undefined) {
    query.limit(contextWindow);
  }

  const messages = await query.exec();

  return messages.reverse();
}

  async countByConversationId( conversationId: Types.ObjectId ): Promise<number> {

    return MessageModel.countDocuments({
      conversationId,
    }).exec();

  }

  async updateById( messageId: Types.ObjectId,  data: Partial<IMessage>): Promise<MessageDocument | null> {

    return MessageModel.findByIdAndUpdate(
      messageId,   data,{
        returnDocument: "after",
        runValidators: true,
      },
    ).exec();
  
}

  async deleteById(    messageId: Types.ObjectId,  ): Promise<MessageDocument | null> {
    return MessageModel.findByIdAndDelete(
      messageId,
    ).exec();
  }

  async deleteByConversationId(  conversationId: Types.ObjectId,  ): Promise<number> {
    const result =   await MessageModel.deleteMany({conversationId}).exec();
    return result.deletedCount;
  }
}

export const messageRepository =  new MessageRepository();
