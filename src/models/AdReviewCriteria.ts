import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * 광고도안심의 — 공통 심의기준 + 금지광고 목록 (싱글톤, key="default").
 * 원본 api/review.js의 CRITERIA 상수와 PROHIBITED 목록을 DB화.
 */
const AdReviewCriteriaSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    criteriaText: { type: String, default: "" }, // 철도광고물 도안심의 기준 요약(CRITERIA)
    prohibitedList: { type: [String], default: [] }, // 금지광고 대상(제46~50조)
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

export type AdReviewCriteriaDoc = InferSchemaType<typeof AdReviewCriteriaSchema>;
export const AdReviewCriteriaModel =
  models.AdReviewCriteria ?? model("AdReviewCriteria", AdReviewCriteriaSchema);
