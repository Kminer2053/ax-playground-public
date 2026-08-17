import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/settings/embed-test { baseUrl?, model? } — 임베딩 연결 테스트.
 * Ollama /api/embeddings를 직접 호출해 실제 출력 차원·지연을 반환(차원 검증 없이 원시값).
 * 값 미지정 시 저장된 설정/env 사용.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { baseUrl?: string; model?: string } | null;
  const cfg = await getPlaygroundConfig();
  const base = (body?.baseUrl?.trim() || cfg.embedBaseUrl || env.OLLAMA_EMBEDDING_BASE_URL || "http://127.0.0.1:11434")
    .trim()
    .replace(/\/+$/, "");
  const model = (body?.model?.trim() || cfg.embedModel || env.OLLAMA_EMBEDDING_MODEL || "").trim();
  if (!model) return NextResponse.json({ ok: false, error: "임베딩 모델이 지정되지 않았습니다." }, { status: 400 });

  const startedAt = Date.now();
  try {
    const r = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "사규 임베딩 연결 테스트" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `서버 응답 오류 (${r.status})`, latencyMs: Date.now() - startedAt }, { status: 502 });
    }
    const j = (await r.json()) as { embedding?: number[] };
    const dims = Array.isArray(j?.embedding) ? j.embedding.length : 0;
    if (!dims) {
      return NextResponse.json({ ok: false, error: "임베딩 응답이 비어 있습니다(모델명 확인).", latencyMs: Date.now() - startedAt }, { status: 502 });
    }
    return NextResponse.json({ ok: true, dims, model, latencyMs: Date.now() - startedAt });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `연결 실패: ${(e as Error).message}`, latencyMs: Date.now() - startedAt }, { status: 502 });
  }
}
