import { Schema, model, models, deleteModel, type InferSchemaType } from "mongoose";

/**
 * 가드레일 런타임 설정 (싱글톤: key="default").
 * 제어판에서 수정하면 게이트웨이가 이 값을 참조한다(캐시 TTL 30초).
 */
const GuardConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },

    // 기능 on/off
    enableLength: { type: Boolean, default: true },
    enableInjection: { type: Boolean, default: true },
    enablePii: { type: Boolean, default: true },
    enableRateLimit: { type: Boolean, default: true },
    enableOutputPiiMask: { type: Boolean, default: true },
    enableOutputSecrets: { type: Boolean, default: true },
    enableAudit: { type: Boolean, default: true },

    // 임계치
    maxInputChars: { type: Number, default: 8000 },
    rateLimitPerWindow: { type: Number, default: 30 },
    rateLimitWindowSec: { type: Number, default: 60 },
    injectionThreshold: { type: Number, default: 3 },

    // 입력 차단 대상 PII 타입 (RRN/FRN/CARD/ACCOUNT/BIZNO/PHONE/EMAIL)
    blockOnInputPii: { type: [String], default: ["RRN", "FRN", "CARD", "ACCOUNT"] },
    maskExtraIps: { type: String, default: "" },

    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

export type GuardConfigDoc = InferSchemaType<typeof GuardConfigSchema>;
// dev(HMR)에서 스키마 변경이 즉시 반영되도록 기존 모델을 폐기 후 재등록한다. Mongoose는 models 캐시를
// 재사용해, 스키마에 필드를 추가해도 dev 서버 재시작 전엔 옛 스키마가 남아 새 필드가 저장 시 잘려나간다
// (strict 모드). 운영(NODE_ENV=production)은 최초 1회만 등록.
if (process.env.NODE_ENV !== "production" && models.GuardConfig) deleteModel("GuardConfig");
export const GuardConfigModel = models.GuardConfig ?? model("GuardConfig", GuardConfigSchema);
