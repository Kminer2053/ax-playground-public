import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * 광고도안심의 — 업종별 심의 룰셋 (원본 광고심의 앱의 RULESETS DB화).
 * 관리자 페이지(P10)에서 CRUD, /api/ad/review가 lib/ad-rules.ts 로더로 조회.
 */
const AdIndustryRuleSchema = new Schema(
  {
    industry: { type: String, required: true, unique: true }, // 업종명 (INDUSTRY)
    category: { type: String, required: true }, // 분야
    highRisk: { type: Boolean, default: false }, // 고위험
    banned: { type: Boolean, default: false }, // 금지(원칙 금지 업종)
    basis: { type: String, default: "" }, // 근거 법령·조항
    riskExpressions: { type: [String], default: [] }, // 고위험·주의 표현
    requiredNotices: { type: [String], default: [] }, // 필수 고지문구
    attachments: { type: [String], default: [] }, // 필요 첨부서류
    note: { type: String, default: "" }, // 참고(예외·단서)
    rejections: { type: [String], default: [] }, // 반려 사유 예시
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type AdIndustryRuleDoc = InferSchemaType<typeof AdIndustryRuleSchema>;
export const AdIndustryRuleModel =
  models.AdIndustryRule ?? model("AdIndustryRule", AdIndustryRuleSchema);
