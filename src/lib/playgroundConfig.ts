import { connectDb } from "@/lib/db";
import { PlaygroundConfigModel } from "@/models/PlaygroundConfig";
import { ADMIN_MAX_FILE_MB, ADMIN_MAX_IMAGE_MB } from "@/lib/uploadLimits";
import { sanitizePanelIntro, type PanelContrib } from "@/lib/panel-intro";
import { sanitizePanelOverrides, type BuildingOverride } from "@/lib/playground-map";

/** 해석된 운영 설정 (비밀값 제외 — 관리자 UI 노출 가능). */
export type ResolvedPlaygroundConfig = {
  popularWindowDays: number;
  popularMinLikes: number;
  popularCount: number;
  quizTimeLimitSec: number;
  /** 기관명 — 문서 생성 등 기관 고유 문구에 사용. */
  orgName: string;
  /** 대표자 성명 — 비우면 화면·프롬프트에서 "○○○" 플레이스홀더. */
  ceoName: string;
  /** 패널 스플래시 기여자·배지 (패널key → {ideaBy, codeBy, badge}). 비면 코드 기본값. */
  panelIntro: Record<string, PanelContrib>;
  /** 메인 건물 오버라이드 (건물id → {label, desc, externalUrl, hidden}). 비면 코드 기본값. */
  panelOverrides: Record<string, BuildingOverride>;
  llmBaseUrl: string;
  llmDefaultModel: string;
  featureModels: Record<string, string>;
  uploadImageMb: number;
  uploadFileMb: number;
  ragVectorEnabled: boolean;
  ragGraphEnabled: boolean;
  embedBaseUrl: string;
  embedModel: string;
  embedDims: number;
  adminAllowedIps: string; // 관리자 접속 허용 IP(콤마 구분, 단일/IPv4 CIDR). 비면 제한 없음.
};

export const DEFAULT_PLAYGROUND_CONFIG: ResolvedPlaygroundConfig = {
  popularWindowDays: 14,
  popularMinLikes: 1,
  popularCount: 5,
  quizTimeLimitSec: 15,
  orgName: "", // 기관명 — 관리자 설정에서 입력(빈 값이면 화면·프롬프트는 orgLabel() 폴백)
  ceoName: "",
  panelIntro: {},
  panelOverrides: {},
  llmBaseUrl: "",
  llmDefaultModel: "",
  featureModels: {},
  uploadImageMb: 10,
  uploadFileMb: 100,
  ragVectorEnabled: true,
  ragGraphEnabled: true,
  embedBaseUrl: "",
  embedModel: "",
  embedDims: 0,
  adminAllowedIps: "",
};

function sanitizeFeatureModels(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && val.trim()) out[k] = val.trim();
  }
  return out;
}

function coerce(doc: Record<string, unknown> | null): ResolvedPlaygroundConfig {
  if (!doc) return { ...DEFAULT_PLAYGROUND_CONFIG };
  const num = (v: unknown, d: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : d;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    popularWindowDays: num(doc.popularWindowDays, 14, 1, 365),
    popularMinLikes: num(doc.popularMinLikes, 1, 0, 10_000),
    popularCount: num(doc.popularCount, 5, 1, 50),
    quizTimeLimitSec: num(doc.quizTimeLimitSec, 15, 3, 600),
    orgName: str(doc.orgName),
    ceoName: str(doc.ceoName),
    panelIntro: sanitizePanelIntro(doc.panelIntro),
    panelOverrides: sanitizePanelOverrides(doc.panelOverrides),
    llmBaseUrl: str(doc.llmBaseUrl),
    llmDefaultModel: str(doc.llmDefaultModel),
    featureModels: sanitizeFeatureModels(doc.featureModels),
    uploadImageMb: num(doc.uploadImageMb, 10, 1, ADMIN_MAX_IMAGE_MB),
    uploadFileMb: num(doc.uploadFileMb, 100, 1, ADMIN_MAX_FILE_MB),
    ragVectorEnabled: bool(doc.ragVectorEnabled, true),
    ragGraphEnabled: bool(doc.ragGraphEnabled, true),
    embedBaseUrl: str(doc.embedBaseUrl),
    embedModel: str(doc.embedModel),
    embedDims: num(doc.embedDims, 0, 0, 8192),
    adminAllowedIps: str(doc.adminAllowedIps),
  };
}

// 프로세스별 메모리 캐시 (TTL 30초). 원본 doc 1회 로드 → 일반설정·비밀값 공유.
const TTL_MS = 30_000;
let _docCache: { doc: Record<string, unknown> | null; at: number } | null = null;
let _lastResolved: ResolvedPlaygroundConfig | null = null;

async function loadDoc(): Promise<Record<string, unknown> | null> {
  const now = Date.now();
  if (_docCache && now - _docCache.at < TTL_MS) return _docCache.doc;
  await connectDb();
  const doc = await PlaygroundConfigModel.findOne({ key: "default" })
    .lean<Record<string, unknown> | null>()
    .exec();
  _docCache = { doc, at: now };
  return doc;
}

/** 캐시된 운영 설정. DB 실패 시 마지막값 또는 기본값 폴백. */
export async function getPlaygroundConfig(): Promise<ResolvedPlaygroundConfig> {
  try {
    const resolved = coerce(await loadDoc());
    _lastResolved = resolved;
    return resolved;
  } catch {
    return _lastResolved ?? { ...DEFAULT_PLAYGROUND_CONFIG };
  }
}

/** 비밀값(LLM API 키, 관리자 암호 해시) — UI로 보내지 말 것. 같은 캐시 공유. */
export async function getConfigSecrets(): Promise<{ llmApiKey: string; adminKeyHash: string; safetyBoardPwHash: string }> {
  try {
    const doc = await loadDoc();
    return {
      llmApiKey: typeof doc?.llmApiKey === "string" ? doc.llmApiKey : "",
      adminKeyHash: typeof doc?.adminKeyHash === "string" ? doc.adminKeyHash : "",
      safetyBoardPwHash: typeof doc?.safetyBoardPwHash === "string" ? doc.safetyBoardPwHash : "",
    };
  } catch {
    return { llmApiKey: "", adminKeyHash: "", safetyBoardPwHash: "" };
  }
}

/** 설정 저장 후 호출 — 캐시 즉시 무효화. */
export function invalidatePlaygroundConfigCache(): void {
  _docCache = null;
  _lastResolved = null;
}
