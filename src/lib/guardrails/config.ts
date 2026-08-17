import { connectDb } from "@/lib/db";
import { GuardConfigModel } from "@/models/GuardConfig";
import type { PiiType } from "./pii-patterns";

/** 게이트웨이가 사용하는 해석된 가드레일 설정. */
export type ResolvedGuardConfig = {
  enableLength: boolean;
  enableInjection: boolean;
  enablePii: boolean;
  enableRateLimit: boolean;
  enableOutputPiiMask: boolean;
  enableOutputSecrets: boolean;
  enableAudit: boolean;
  maxInputChars: number;
  rateLimitPerWindow: number;
  rateLimitWindowSec: number;
  injectionThreshold: number;
  blockOnInputPii: PiiType[];
  /** 출력에서 [IP]로 가릴 추가 보호 IP(콤마 구분). 사설대역·env와 합쳐 적용(SEC-008). */
  maskExtraIps: string;
};

export const DEFAULT_GUARD_CONFIG: ResolvedGuardConfig = {
  enableLength: true,
  enableInjection: true,
  enablePii: true,
  enableRateLimit: true,
  enableOutputPiiMask: true,
  enableOutputSecrets: true,
  enableAudit: true,
  maxInputChars: 8000,
  rateLimitPerWindow: 30,
  rateLimitWindowSec: 60,
  injectionThreshold: 3,
  blockOnInputPii: ["RRN", "FRN", "CARD", "ACCOUNT"],
  maskExtraIps: "",
};

const VALID_PII_TYPES: PiiType[] = ["RRN", "FRN", "CARD", "ACCOUNT", "BIZNO", "PHONE", "EMAIL"];

function coerce(doc: Record<string, unknown> | null): ResolvedGuardConfig {
  if (!doc) return { ...DEFAULT_GUARD_CONFIG };
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const types = Array.isArray(doc.blockOnInputPii)
    ? (doc.blockOnInputPii.filter((t): t is PiiType => VALID_PII_TYPES.includes(t as PiiType)))
    : DEFAULT_GUARD_CONFIG.blockOnInputPii;
  return {
    enableLength: bool(doc.enableLength, true),
    enableInjection: bool(doc.enableInjection, true),
    enablePii: bool(doc.enablePii, true),
    enableRateLimit: bool(doc.enableRateLimit, true),
    enableOutputPiiMask: bool(doc.enableOutputPiiMask, true),
    enableOutputSecrets: bool(doc.enableOutputSecrets, true),
    enableAudit: bool(doc.enableAudit, true),
    maxInputChars: num(doc.maxInputChars, 8000),
    rateLimitPerWindow: num(doc.rateLimitPerWindow, 30),
    rateLimitWindowSec: num(doc.rateLimitWindowSec, 60),
    injectionThreshold: num(doc.injectionThreshold, 3),
    blockOnInputPii: types.length > 0 ? types : DEFAULT_GUARD_CONFIG.blockOnInputPii,
    maskExtraIps: typeof doc.maskExtraIps === "string" ? doc.maskExtraIps : "",
  };
}

// 메모리 캐시 (프로세스별, TTL 30초) — 매 요청 DB 조회 방지.
const TTL_MS = 30_000;
let _cache: { config: ResolvedGuardConfig; at: number } | null = null;

/** 캐시된 가드레일 설정 반환. DB 조회 실패 시 기본값으로 폴백(fail-open). */
export async function getGuardConfig(): Promise<ResolvedGuardConfig> {
  const now = Date.now();
  if (_cache && now - _cache.at < TTL_MS) return _cache.config;
  try {
    await connectDb();
    const doc = await GuardConfigModel.findOne({ key: "default" }).lean<Record<string, unknown> | null>().exec();
    const config = coerce(doc);
    _cache = { config, at: now };
    return config;
  } catch {
    // DB 불가 시 기본 설정으로 동작 (가드 자체는 멈추지 않음).
    return _cache?.config ?? { ...DEFAULT_GUARD_CONFIG };
  }
}

/** 제어판에서 설정 저장 후 호출 — 캐시 즉시 무효화. */
export function invalidateGuardConfigCache(): void {
  _cache = null;
}
