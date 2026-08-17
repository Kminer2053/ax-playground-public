import { Types } from "mongoose";
import { PointLogModel } from "@/models/PointLog";
import { UserModel } from "@/models/User";

export type PointLogType = "login" | "quiz" | "prompt_register" | "like_received" | "admin";

export async function awardPoints(args: {
  userId: Types.ObjectId;
  type: PointLogType;
  amount: number;
  refId?: string;
}) {
  if (!Number.isFinite(args.amount) || args.amount === 0) return;

  await Promise.all([
    PointLogModel.create({
      userId: args.userId,
      type: args.type,
      amount: args.amount,
      refId: args.refId,
    }),
    UserModel.updateOne(
      { _id: args.userId },
      { $inc: { totalPoints: args.amount, monthlyPoints: args.amount } },
    ),
  ]);
}

