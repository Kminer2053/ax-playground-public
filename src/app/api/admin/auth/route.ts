import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { verifyAdminKeyResolved } from "@/lib/adminAuth";
import { isAdminIpAllowed } from "@/lib/adminIp";
import { buildGuardContext } from "@/lib/guardrails";
import { checkRateLimit } from "@/lib/guardrails/input/ratelimit";

export const dynamic = "force-dynamic";

/** 관리자 인증: 접속 IP 허용 + ADMIN_ACCESS_KEY 일치 시 세션에 admin=true 저장. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { key?: string } | null;
  const key = typeof body?.key === "string" ? body.key : "";

  // 허용 IP 제한(설정 시) — 인증키 검증 전에 차단해 명확히 안내(브루트포스 표면도 축소).
  if (!(await isAdminIpAllowed())) {
    return NextResponse.json({ ok: false, error: "허용되지 않은 IP에서의 접속입니다. 관리자에게 문의하세요." }, { status: 403 });
  }
  // 무차별 대입 방지: 쿠키가 아닌 IP 기준으로 분당 시도 횟수를 제한(키 검증 전에 카운트).
  const ctx = await buildGuardContext(req, "other");
  const rl = await checkRateLimit({ ...ctx, userId: null, clientId: null }, { perWindow: 10, windowSec: 60 });
  if (!rl.ok && rl.block) {
    return NextResponse.json({ ok: false, error: "로그인 시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, { status: rl.block.status });
  }
  if (!(await verifyAdminKeyResolved(key))) {
    return NextResponse.json({ ok: false, error: "인증키가 올바르지 않습니다." }, { status: 401 });
  }

  const session = await getSession();
  session.admin = true;
  await session.save();
  return NextResponse.json({ ok: true });
}

/** 관리자 로그아웃: 세션 파기. */
export async function DELETE() {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}

/** 현재 관리자 인증 상태 조회 (관리자 UI 게이트용). */
export async function GET() {
  const session = await getSession();
  return NextResponse.json({ ok: true, admin: session.admin === true });
}
