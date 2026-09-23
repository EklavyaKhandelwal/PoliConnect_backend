import { UserModel, type UserDocument } from "../models/user.model";
import type { Types } from "mongoose";
import type { IUser } from "../types/common.types";

 class UserRepository {


  async create(data: Omit<IUser, "_id"> ): Promise<UserDocument> {

    return UserModel.create(data);
  
}

  async findById( userId: Types.ObjectId  ): Promise<UserDocument | null> {

    return UserModel.findById(userId).exec();
  }





  async findByEmail( email: string): Promise<UserDocument | null> {
    return UserModel.findOne({  email: email.toLowerCase().trim() })
      .select("+password")
      .exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return UserModel.find()
      .sort({ createdAt: -1 })
      .exec();
  }

  async updateById(userId: Types.ObjectId, data: Partial<IUser> ): Promise<UserDocument | null> {

    return UserModel.findByIdAndUpdate(  userId,  data,
      {
        returnDocument: "after",
        runValidators: true,
      },
    ).exec();


  }

  async deleteById( userId: Types.ObjectId ): Promise<UserDocument | null> {

    return UserModel.findByIdAndDelete(userId).exec();
  }

  async existsByEmail(email: string ): Promise<boolean> {


    const user = await UserModel.exists({
      email: email.toLowerCase().trim(),
    });

    return user !== null;
  }


}

export const userRepository =  new UserRepository();
