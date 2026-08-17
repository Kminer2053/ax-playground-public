import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { resolveLlmTarget } from "@/lib/llm";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settings/models?baseUrl=&apiKey= — LLM 서버 모델 목록(프록시).
 * baseUrl 미지정 시 저장된 설정/ env 값을 사용. 폐쇄망 내부 서버 전용.
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const target = await resolveLlmTarget();
  const baseUrl = (sp.get("baseUrl") || target.baseURL || "").trim().replace(/\/+$/, "");
  const apiKey = sp.get("apiKey") || target.apiKey || "ollama";
  if (!baseUrl) {
    return NextResponse.json({ ok: false, error: "LLM 서버 주소가 설정되지 않았습니다." }, { status: 400 });
  }
  try {
    const r = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `서버 응답 오류 (${r.status})` }, { status: 502 });
    }
    const j = (await r.json()) as { data?: { id?: string }[] };
    const models = Array.isArray(j?.data)
      ? j.data.map((m) => m?.id).filter((id): id is string => Boolean(id))
      : [];
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `연결 실패: ${(e as Error).message}` }, { status: 502 });
  }
}
