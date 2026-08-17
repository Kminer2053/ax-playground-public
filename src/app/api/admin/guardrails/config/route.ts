import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { GuardConfigModel } from "@/models/GuardConfig";
import { getGuardConfig, invalidateGuardConfigCache } from "@/lib/guardrails";

export const dynamic = "force-dynamic";

const VALID_PII_TYPES = ["RRN", "FRN", "CARD", "ACCOUNT", "BIZNO", "PHONE", "EMAIL"];
const BOOL_FIELDS = [
  "enableLength",
  "enableInjection",
  "enablePii",
  "enableRateLimit",
  "enableOutputPiiMask",
  "enableOutputSecrets",
  "enableAudit",
] as const;
const NUM_FIELDS: Record<string, [number, number]> = {
  maxInputChars: [100, 100_000],
  rateLimitPerWindow: [1, 100_000],
  rateLimitWindowSec: [1, 3600],
  injectionThreshold: [1, 20],
};

/** GET — 현재 가드레일 설정 (admin 전용). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const config = await getGuardConfig();
  return NextResponse.json({ ok: true, config });
}

/** PUT — 가드레일 설정 저장 + 캐시 무효화 (admin 전용). */
export async function PUT(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const update: Record<string, unknown> = { key: "default", updatedBy: "admin" };

  for (const f of BOOL_FIELDS) {
    if (typeof body[f] === "boolean") update[f] = body[f];
  }
  for (const [f, [min, max]] of Object.entries(NUM_FIELDS)) {
    if (body[f] != null) {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < min || n > max) {
        return NextResponse.json({ error: `${f}는 ${min}~${max} 범위여야 합니다.` }, { status: 400 });
      }
      update[f] = Math.floor(n);
    }
  }
  if (Array.isArray(body.blockOnInputPii)) {
    const types = body.blockOnInputPii.filter((t): t is string => typeof t === "string" && VALID_PII_TYPES.includes(t));
    update.blockOnInputPii = [...new Set(types)];
  }
  if (typeof body.maskExtraIps === "string") {
    // 출력 마스킹 보호 IP(콤마 구분) — 유효한 IPv4 리터럴만 저장(오입력·인젝션 방지).
    const ips = body.maskExtraIps.split(",").map((s) => s.trim()).filter((s) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(s));
    if (ips.some((ip) => ip.split(".").some((o) => Number(o) > 255))) {
      return NextResponse.json({ error: "IP 형식이 올바르지 않습니다(0~255)." }, { status: 400 });
    }
    update.maskExtraIps = [...new Set(ips)].join(",");
  }

  await connectDb();
  // strict:false — 새로 추가한 스키마 필드(예: maskExtraIps)가 dev HMR로 갱신 안 된 옛 모델에서
  // strict 모드로 조용히 잘려나가는 문제 방지. update는 위에서 서버가 화이트리스트로 조립한 값뿐.
  await GuardConfigModel.findOneAndUpdate({ key: "default" }, { $set: update }, { upsert: true, new: true, strict: false });

  // 게이트웨이 캐시 즉시 무효화 → 다음 요청부터 반영.
  invalidateGuardConfigCache();

  const config = await getGuardConfig();
  return NextResponse.json({ ok: true, config });
}
