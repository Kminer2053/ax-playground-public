import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { chatLlm } from "@/lib/llm";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/settings/test { baseUrl?, apiKey?, model? } — 설정 테스트.
 * 짧은 프롬프트로 실제 호출해 응답·지연을 반환. 값 미지정 시 저장된 설정 사용.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | { baseUrl?: string; apiKey?: string; model?: string }
    | null;
  const override = {
    baseURL: body?.baseUrl?.trim() || undefined,
    apiKey: body?.apiKey?.trim() || undefined,
    model: body?.model?.trim() || undefined,
  };
  const startedAt = Date.now();
  try {
    // 연결 테스트 전용: 관리자가 입력한 LLM 설정(baseUrl/apiKey/model)의 '원시 도달성'을 검증하는 것이
    // 목적이라 가드레일 게이트웨이를 의도적으로 경유하지 않는다(게이트를 거치면 설정이 아니라 게이트
    // 동작을 검증하게 됨). 고정 프롬프트·관리자 전용이라 우회 위험 없음.
    const reply = await chatLlm([{ role: "user", content: "다음 단어를 그대로 한 번만 출력: OK" }], {
      maxTokens: 16,
      temperature: 0,
      override,
    });
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - startedAt,
      sample: reply.trim().slice(0, 200),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, latencyMs: Date.now() - startedAt },
      { status: 502 },
    );
  }
}
