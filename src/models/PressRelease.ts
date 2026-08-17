import { Schema, model, models, type InferSchemaType, Types } from "mongoose";

const PressReleaseSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, required: true, enum: ["draft", "submitted", "confirmed"], default: "draft" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    distributed: { type: Boolean, default: false },
    distributedDate: { type: String, default: "" },
    articles: [{ media: String, title: String, date: String }],
  },
  { timestamps: true },
);

export type PressReleaseDoc = InferSchemaType<typeof PressReleaseSchema> & { createdBy: Types.ObjectId };
export const PressReleaseModel = models.PressRelease ?? model("PressRelease", PressReleaseSchema);
