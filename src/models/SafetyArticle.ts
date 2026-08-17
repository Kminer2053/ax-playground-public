import { Schema, model, models, type InferSchemaType } from "mongoose";

const AttachmentSchema = new Schema(
  { name: { type: String, required: true }, size: { type: Number, default: 0 }, url: { type: String, required: true } },
  { _id: false },
);

const SafetyArticleSchema = new Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    type: { type: String, required: true, enum: ["news", "library"], index: true },
    thumbnailUrl: { type: String },
    /** 공지(news) 대표 이미지 URL. */
    imageUrl: { type: String, default: "" },
    /** 자료실(library) 첨부파일. */
    attachments: { type: [AttachmentSchema], default: [] },
  },
  { timestamps: true },
);

export type SafetyArticleDoc = InferSchemaType<typeof SafetyArticleSchema>;
export const SafetyArticleModel = models.SafetyArticle ?? model("SafetyArticle", SafetyArticleSchema);
