import { NextResponse } from "next/server";
import { askLlm, getChatLlmMode, isChatLlmConfigured } from "@/lib/llm";

/**
 * 채팅 LLM 설정 여부 확인 (키 값은 노출하지 않음).
 * ?ping=1 이면 실제 API 호출로 연결 동작 여부까지 검증.
 */
export async function GET(req: Request) {
  const mode = getChatLlmMode();
  const configured = isChatLlmConfigured();
  const url = new URL(req.url);
  const doPing = url.searchParams.get("ping") === "1";

  if (!configured) {
    return NextResponse.json({ llmConfigured: false, llmMode: null, ping: null });
  }

  if (!doPing) {
    return NextResponse.json({ llmConfigured: true, llmMode: mode, ping: null });
  }

  try {
    // 헬스체크 전용: 고정 입력("Say OK")으로 LLM 연결만 확인한다. 사용자 데이터를
    // 처리하지 않으므로 가드레일 게이트웨이를 의도적으로 경유하지 않는다
    // (감사 로그·rate limit 노이즈 방지). 사용자 입력을 받지 않아 우회 위험 없음.
    const reply = await askLlm("Say exactly: OK", undefined);
    const ok = reply.trim().toUpperCase().includes("OK");
    return NextResponse.json({ llmConfigured: true, llmMode: mode, ping: ok ? "ok" : "unexpected" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { llmConfigured: true, llmMode: mode, ping: "error", error: msg },
      { status: 503 }
    );
  }
}
