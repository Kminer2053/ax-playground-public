import { Schema, model, models, type InferSchemaType, Types } from "mongoose";

const PointLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "User" },
    type: {
      type: String,
      required: true,
      enum: ["login", "quiz", "prompt_register", "like_received", "admin"],
      index: true,
    },
    amount: { type: Number, required: true },
    refId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type PointLogDoc = InferSchemaType<typeof PointLogSchema> & { userId: Types.ObjectId };
export const PointLogModel = models.PointLog ?? model("PointLog", PointLogSchema);

