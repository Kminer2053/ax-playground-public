import { Schema, model, models, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    dept: { type: String, required: true, index: true },
    position: { type: String },
    totalPoints: { type: Number, required: true, default: 0, index: true },
    monthlyPoints: { type: Number, required: true, default: 0, index: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const UserModel = models.User ?? model("User", UserSchema);

