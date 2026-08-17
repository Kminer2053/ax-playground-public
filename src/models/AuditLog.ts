import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Guardrail M09: AI 입·출력 감사 로그.
 * 모든 guardedChat 호출(통과/차단)이 1건씩 기록된다.
 * 파일 로그(/var/log/axp-audit.log)와 이중 저장 — 이쪽은 검색·일일 리포트용.
 */
const AuditLogSchema = new Schema(
  {
    requestId: { type: String, required: true, index: true },
    userId: { type: String, default: null, index: true },
    role: { type: String, default: null },
    ip: { type: String, default: null },
    panel: { type: String, required: true, index: true },
    // "pass" = 정상 응답, "blocked" = 가드 차단, "error" = 입력통과 후 LLM/처리 실패
    outcome: { type: String, enum: ["pass", "blocked", "error"], required: true, index: true },
    stage: { type: String, enum: ["input", "model", "output", null], default: null },
    ruleId: { type: String, default: null, index: true },
    inputLen: { type: Number, default: 0 },
    outputLen: { type: Number, default: 0 },
    // 출력에서 마스킹된 PII/시크릿 타입 목록 (예: ["PHONE","EMAIL"])
    maskedTypes: { type: [String], default: [] },
    latencyMs: { type: Number, default: 0 },
    // AUDIT_LOG_FULL_TEXT=true 일 때만 채움
    inputText: { type: String, default: null },
    outputText: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// 일일 리포트 집계용 복합 인덱스 (시간 + 결과).
AuditLogSchema.index({ createdAt: -1, outcome: 1 });

export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema>;
export const AuditLogModel = models.AuditLog ?? model("AuditLog", AuditLogSchema);
