
import { SessionModel, type SessionDocument} from "../models/session.model";


import type { Types } from "mongoose";
import type { ISession } from "../types/common.types";

 class SessionRepository {



  async create(data: ISession): Promise<SessionDocument> {

    return SessionModel.create(data);
  }

  async findById( sessionId: Types.ObjectId ): Promise<SessionDocument | null> {

    return SessionModel.findById(sessionId).exec();
  }
  async findSessionByUserId( userId: Types.ObjectId ): Promise<SessionDocument | null> {

    return SessionModel.findOne({ userId }).exec();
  }

  async findByUserId( userId: Types.ObjectId): Promise<SessionDocument[]> {

    return SessionModel.find({userId})
      .sort({ updatedAt: -1 })
      .exec();
  }

  async findByGuestId( guestId: string,): Promise<SessionDocument[]> {
    return SessionModel.find({
      guestId: guestId.trim(),
    })
    .sort({ updatedAt: -1 })
    .exec();
  }

  async findByUserIdAndGuestId( userId: Types.ObjectId, guestId: string,): Promise<SessionDocument | null> {

    return SessionModel.findOne({
      userId,
      guestId: guestId.trim(),
    }).exec();

  }

  async updateById( sessionId: Types.ObjectId, data: Partial<ISession>): Promise<SessionDocument | null> {

    return SessionModel.findByIdAndUpdate(  sessionId, data,
      {
        returnDocument: "after",
        runValidators: true,
      },
    ).exec();
  }

  async deleteById( sessionId: Types.ObjectId ): Promise<SessionDocument | null> {
    return SessionModel.findByIdAndDelete(
      sessionId,
    ).exec();
  }

  async existsById( sessionId: Types.ObjectId,): Promise<boolean> {

    const session = await SessionModel.exists({ _id: sessionId});
    return session !== null;
  
}
}

export const sessionRepository =  new SessionRepository();
