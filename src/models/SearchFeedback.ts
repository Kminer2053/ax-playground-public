import { Schema, model, models, type InferSchemaType } from "mongoose";

/** 지식검색(AI 어시스턴트) 답변 만족도 피드백 — 👍/👎 + 불만족 사유·참고이미지.
 *  관리자 검색품질 분석 대시보드의 원천 데이터. */
const SearchFeedbackSchema = new Schema(
  {
    panel: { type: String, required: true, default: "knowledge" },
    rating: { type: String, required: true, enum: ["up", "down"] },
    question: { type: String, default: "" },
    answer: { type: String, default: "" },          // 답변(분석용, 길이 제한 저장)
    mode: { type: String, default: "" },            // fast | deep
    intent: { type: String, default: "" },          // 심층모드 파악 의도
    citations: { type: [String], default: [] },     // 근거 문서 제목들(어떤 사규가 인용됐는지)
    usedVector: { type: Boolean, default: false },  // 의미(임베딩)검색이 근거에 기여했는지
    usedGraph: { type: Boolean, default: false },   // 그래프(참조·위계) 확장이 근거에 기여했는지
    reason: { type: String, default: "" },          // 불만족 사유(👎)
    imageUrl: { type: String, default: "" },        // 참고이미지(👎)
    status: { type: String, default: "new", enum: ["new", "reviewed", "resolved"] }, // 관리자 처리상태
    day: { type: String, required: true },          // YYYY-MM-DD(집계용, usage.ts와 동일 컨벤션)
    clientId: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true }
);

SearchFeedbackSchema.index({ panel: 1, rating: 1, day: 1 });
SearchFeedbackSchema.index({ createdAt: -1 });
SearchFeedbackSchema.index({ status: 1, createdAt: -1 });

export type SearchFeedbackDoc = InferSchemaType<typeof SearchFeedbackSchema>;
export const SearchFeedbackModel = models.SearchFeedback ?? model("SearchFeedback", SearchFeedbackSchema);
