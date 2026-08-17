import { Schema, model, models, type InferSchemaType } from "mongoose";

const ResourceSchema = new Schema(
  {
    title: { type: String, required: true },
    type: { type: String, required: true, enum: ["video", "document"], index: true },
    category: { type: String, required: true, index: true },
    fileUrl: { type: String },
    thumbnailUrl: { type: String },
    viewCount: { type: Number, required: true, default: 0, index: true },
    createdBy: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ResourceSchema.index({ createdAt: -1 });

export type ResourceDoc = InferSchemaType<typeof ResourceSchema>;
export const ResourceModel = models.Resource ?? model("Resource", ResourceSchema);

