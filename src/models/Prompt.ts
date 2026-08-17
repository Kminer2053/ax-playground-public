import { Schema, model, models, type InferSchemaType, Types } from "mongoose";

const PromptSchema = new Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    category: {
      type: String,
      required: true,
      enum: ["sales", "knowledge", "safety", "pr", "cs", "hr"],
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, required: true, index: true, ref: "User" },
    likeCount: { type: Number, required: true, default: 0, index: true },
    likedBy: { type: [Schema.Types.ObjectId], required: true, default: [], ref: "User" },
    tip: { type: String, required: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

PromptSchema.index({ createdAt: -1 });

export type PromptDoc = InferSchemaType<typeof PromptSchema> & {
  createdBy: Types.ObjectId;
  likedBy: Types.ObjectId[];
};
export const PromptModel = models.Prompt ?? model("Prompt", PromptSchema);

