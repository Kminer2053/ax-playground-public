import { Schema, model, models, type InferSchemaType, Types } from "mongoose";

const VocItemSchema = new Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    status: { type: String, required: true, enum: ["registered", "reviewing", "completed"], default: "registered" },
    dept: { type: String, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, required: true, index: true, ref: "User" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    aiSuggestion: { type: String },
    reply: { type: String },
    repliedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

VocItemSchema.index({ createdAt: -1 });

export type VocItemDoc = InferSchemaType<typeof VocItemSchema> & {
  createdBy: Types.ObjectId;
  assignedTo?: Types.ObjectId;
  repliedBy?: Types.ObjectId;
};
export const VocItemModel = models.VocItem ?? model("VocItem", VocItemSchema);

