import { NextResponse } from "next/server";
import { guardedChat, buildGuardContext, isGuardBlockedError } from "@/lib/guardrails";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { orgLabel } from "@/lib/org";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

const systemPrompt = (org: string) => `당신은 ${org} 매장 운영 전문 AI 분석가입니다.
아래 매장 매출 분석 데이터를 바탕으로 점장과 FC(현장 관리자)가 즉시 실행할 수 있는 진단을 작성하세요.

출력 형식 (반드시 준수):
## 왜 이런 매출이 나왔나?
(데이터 근거와 함께 2~3문장. 잘된 점과 부족한 점을 균형있게.)

## 오늘 당장 해야 할 일
(번호 목록으로 3~5가지. 구체적 상품명·수량 포함. "검토 필요" 같은 모호한 표현 금지.)

## 이번 주 놓친 기회
(1~2문장. 경쟁 매장 대비 격차와 금액으로 표현.)

항상 한국어로, 현장 직원이 바로 이해할 수 있는 구어체로 작성하세요.`;

/**
 * POST /api/sales/diagnosis — 브라우저에서 분석한 매출 요약(analysisContext)으로 AI 진단 생성.
 * 원본 데이터(엑셀)는 서버로 오지 않고, 요약 텍스트만 가드레일(guardedChat) 경유로 내부 LLM에 전달.
 * body: { analysisContext: string, storeName?: string }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { analysisContext?: string; storeName?: string };
  const analysisContext = body.analysisContext?.trim();
  const storeName = body.storeName?.trim() || "매장";
  if (!analysisContext) return NextResponse.json({ error: "analysisContext가 필요합니다." }, { status: 400 });

  const userPrompt = `다음은 ${storeName}의 매출 분석 데이터입니다:\n\n${analysisContext}\n\n위 데이터를 바탕으로 진단을 작성해 주세요.`;
  const ctx = await buildGuardContext(req, "sales");
  const org = orgLabel((await getPlaygroundConfig()).orgName);
  try {
    const diagnosis = await guardedChat({
      messages: [{ role: "user", content: userPrompt }],
      ctx,
      system: systemPrompt(org),
      maxTokens: 2000,
      temperature: 0.4,
      guardInput: analysisContext,
    });
    recordUsage("sales", "diagnosis"); // 매장 진단
    return NextResponse.json({ ok: true, diagnosis: diagnosis.trim(), provider: "internal" });
  } catch (e) {
    if (isGuardBlockedError(e)) {
      return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    }
    return NextResponse.json({ error: "AI 진단 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
