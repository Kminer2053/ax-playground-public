import { Schema, model, models, type InferSchemaType } from "mongoose";

/** 기능 사용통계 — 일별 카운터(feature+action+day 유니크, $inc 집계). P10 대시보드. */
const FeatureUsageSchema = new Schema({
  feature: { type: String, required: true },
  action: { type: String, required: true, default: "use" },
  day: { type: String, required: true }, // YYYY-MM-DD
  count: { type: Number, required: true, default: 0 },
});

FeatureUsageSchema.index({ feature: 1, action: 1, day: 1 }, { unique: true });
FeatureUsageSchema.index({ day: 1 });

export type FeatureUsageDoc = InferSchemaType<typeof FeatureUsageSchema>;
export const FeatureUsageModel = models.FeatureUsage ?? model("FeatureUsage", FeatureUsageSchema);
