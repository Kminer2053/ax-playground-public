import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Guardrail GR1-4: 요청 속도 제한용 카운터.
 * key = "${type}:${value}:${panel}:${windowStartMs}" 형태로 분 단위 버킷을 식별.
 * expiresAt TTL 인덱스로 Mongo가 자동 삭제 — 별도 청소 작업 불필요.
 */
const GuardRateLimitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    panel: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    windowStart: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL: expiresAt 시점이 지나면 Mongo가 자동 삭제 (expireAfterSeconds=0 → expiresAt 자체가 만료시각).
GuardRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type GuardRateLimitDoc = InferSchemaType<typeof GuardRateLimitSchema>;
export const GuardRateLimitModel =
  models.GuardRateLimit ?? model("GuardRateLimit", GuardRateLimitSchema);
