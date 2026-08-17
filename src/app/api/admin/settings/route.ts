import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { PlaygroundConfigModel } from "@/models/PlaygroundConfig";
import {
  getPlaygroundConfig,
  getConfigSecrets,
  invalidatePlaygroundConfigCache,
} from "@/lib/playgroundConfig";
import { hashPassword } from "@/lib/postAuth";
import { ADMIN_MAX_FILE_MB, ADMIN_MAX_IMAGE_MB, getUploadLimitsMeta } from "@/lib/uploadLimits";
import { sanitizePanelIntro } from "@/lib/panel-intro";
import { sanitizePanelOverrides } from "@/lib/playground-map";

export const dynamic = "force-dynamic";

async function publicSettings() {
  const cfg = await getPlaygroundConfig();
  const { llmApiKey, adminKeyHash, safetyBoardPwHash } = await getConfigSecrets();
  return {
    orgName: cfg.orgName,
    ceoName: cfg.ceoName,
    panelIntro: cfg.panelIntro,
    panelOverrides: cfg.panelOverrides,
    llmBaseUrl: cfg.llmBaseUrl,
    llmDefaultModel: cfg.llmDefaultModel,
    featureModels: cfg.featureModels,
    uploadImageMb: cfg.uploadImageMb,
    uploadFileMb: cfg.uploadFileMb,
    ragVectorEnabled: cfg.ragVectorEnabled,
    ragGraphEnabled: cfg.ragGraphEnabled,
    embedBaseUrl: cfg.embedBaseUrl,
    embedModel: cfg.embedModel,
    embedDims: cfg.embedDims,
    adminAllowedIps: cfg.adminAllowedIps,
    hasApiKey: Boolean(llmApiKey),
    hasAdminKey: Boolean(adminKeyHash),
    hasSafetyPw: Boolean(safetyBoardPwHash),
    uploadLimits: getUploadLimitsMeta(),
  };
}

/** GET /api/admin/settings — 설정 조회(비밀값은 boolean으로만 노출). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, settings: await publicSettings() });
}

/** PUT /api/admin/settings — LLM·업로드 설정 저장. apiKey는 값이 있을 때만 갱신. */
export async function PUT(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const set: Record<string, unknown> = { key: "default", updatedBy: "admin" };

  if (typeof body.llmBaseUrl === "string") {
    const u = body.llmBaseUrl.trim();
    if (u && !/^https?:\/\//i.test(u)) {
      return NextResponse.json({ error: "LLM 서버 주소는 http:// 또는 https://로 시작해야 합니다." }, { status: 400 });
    }
    set.llmBaseUrl = u;
  }
  if (typeof body.llmDefaultModel === "string") set.llmDefaultModel = body.llmDefaultModel.trim();
  // 기관 고유값(기관명·대표자) — 기관마다 다르므로 코드가 아닌 설정으로 관리한다.
  if (body.orgName != null) set.orgName = String(body.orgName).trim().slice(0, 60);
  if (body.ceoName != null) set.ceoName = String(body.ceoName).trim().slice(0, 30);
  // 패널 스플래시 기여자·배지 — 알 수 없는 키/타입은 sanitize 에서 버린다.
  if (body.panelIntro != null) set.panelIntro = sanitizePanelIntro(body.panelIntro);
  // 메인 건물 오버라이드 — 핵심 4기능의 externalUrl·hidden, 잘못된 URL 스킴은 sanitize 에서 버린다.
  if (body.panelOverrides != null) set.panelOverrides = sanitizePanelOverrides(body.panelOverrides);
  if (typeof body.ragVectorEnabled === "boolean") set.ragVectorEnabled = body.ragVectorEnabled;
  if (typeof body.ragGraphEnabled === "boolean") set.ragGraphEnabled = body.ragGraphEnabled;
  if (typeof body.embedBaseUrl === "string") {
    const u = body.embedBaseUrl.trim();
    if (u && !/^https?:\/\//i.test(u)) {
      return NextResponse.json({ error: "임베딩 서버 주소는 http:// 또는 https://로 시작해야 합니다." }, { status: 400 });
    }
    set.embedBaseUrl = u;
  }
  if (typeof body.embedModel === "string") set.embedModel = body.embedModel.trim();
  if (body.embedDims != null) {
    const n = Number(body.embedDims);
    if (!Number.isFinite(n) || n < 0 || n > 8192) {
      return NextResponse.json({ error: "embedDims는 0~8192 범위여야 합니다(0=env 기본)." }, { status: 400 });
    }
    set.embedDims = Math.floor(n);
  }
  if (typeof body.adminAllowedIps === "string") {
    const items = body.adminAllowedIps.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const ok = items.every((r) => /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(r) || /^[0-9a-fA-F:]+$/.test(r));
    if (!ok) return NextResponse.json({ error: "허용 IP 형식 오류 — 단일 IP 또는 IPv4 CIDR(예: 10.0.0.5, 10.0.1.0/24)을 콤마로 구분하세요." }, { status: 400 });
    set.adminAllowedIps = items.join(",");
  }
  if (typeof body.llmApiKey === "string" && body.llmApiKey.trim()) set.llmApiKey = body.llmApiKey.trim();
  if (typeof body.safetyBoardPw === "string") set.safetyBoardPwHash = body.safetyBoardPw.trim() ? hashPassword(body.safetyBoardPw.trim()) : "";

  if (body.featureModels && typeof body.featureModels === "object") {
    const fm: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.featureModels as Record<string, unknown>)) {
      if (/^[a-z]+$/.test(k) && typeof v === "string" && v.trim()) fm[k] = v.trim();
    }
    set.featureModels = fm;
  }

  const ranges: [string, number, number][] = [
    ["uploadImageMb", 1, ADMIN_MAX_IMAGE_MB],
    ["uploadFileMb", 1, ADMIN_MAX_FILE_MB],
  ];
  for (const [f, min, max] of ranges) {
    if (body[f] != null) {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < min || n > max) {
        return NextResponse.json({ error: `${f}는 ${min}~${max} 범위여야 합니다.` }, { status: 400 });
      }
      set[f] = Math.floor(n);
    }
  }

  await connectDb();
  // strict:false — 개발 중 HMR 로 남은 옛 모델 캐시가 새로 추가한 필드를 저장 순간 잘라내는 사고를 막는다.
  await PlaygroundConfigModel.findOneAndUpdate({ key: "default" }, { $set: set }, { upsert: true, strict: false });
  invalidatePlaygroundConfigCache();
  return NextResponse.json({ ok: true, settings: await publicSettings() });
}
