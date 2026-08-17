/**
 * 패널 진입 스플래시 콘텐츠 — 무로그인 공개 조회.
 *
 * 소개·개발배경은 코드 상수, 기여자·배지는 관리자 설정(DB)에서 온다.
 * 설정이 비어 있으면 코드 기본값(목업)으로 폴백한다.
 */
import { NextResponse } from "next/server";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { resolvePanelIntro } from "@/lib/panel-intro";

export const dynamic = "force-dynamic";

export async function GET() {
  let configured: Awaited<ReturnType<typeof getPlaygroundConfig>>["panelIntro"] | null = null;
  try {
    configured = (await getPlaygroundConfig()).panelIntro;
  } catch {
    configured = null; // DB 미가동이어도 스플래시는 떠야 한다 — 코드 기본값 폴백
  }
  return NextResponse.json({ ok: true, panels: resolvePanelIntro(configured) });
}
