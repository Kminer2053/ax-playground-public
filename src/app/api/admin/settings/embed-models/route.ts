import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settings/embed-models?baseUrl= — 임베딩 서버(Ollama) 모델 목록(/api/tags 프록시).
 * baseUrl 미지정 시 저장된 설정/env 사용. 폐쇄망 내부 서버 전용.
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const cfg = await getPlaygroundConfig();
  const base = (sp.get("baseUrl") || cfg.embedBaseUrl || env.OLLAMA_EMBEDDING_BASE_URL || "http://127.0.0.1:11434")
    .trim()
    .replace(/\/+$/, "");
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return NextResponse.json({ ok: false, error: `서버 응답 오류 (${r.status})` }, { status: 502 });
    const j = (await r.json()) as { models?: { name?: string }[] };
    const models = Array.isArray(j?.models) ? j.models.map((m) => m?.name).filter((n): n is string => Boolean(n)) : [];
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `연결 실패: ${(e as Error).message}` }, { status: 502 });
  }
}
