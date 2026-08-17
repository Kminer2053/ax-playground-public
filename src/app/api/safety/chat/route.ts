import { NextResponse } from "next/server";
import { guardedChat, buildGuardContext, isGuardBlockedError } from "@/lib/guardrails";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { orgLabel } from "@/lib/org";
import { recordUsage } from "@/lib/usage";
import { retrieveSafetyContext } from "@/lib/safety-rag";

type SafetyImageAnalysis = {
  riskLevel?: "낮음" | "보통" | "높음" | "심각";
  summary?: string;
  violations?: string[];
  regulations?: string[];
  actions?: string[];
};

function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return null;
}

function parseImageAnalysis(text: string): SafetyImageAnalysis | null {
  const block = extractJsonBlock(text);
  if (!block) return null;
  try {
    const parsed = JSON.parse(block) as SafetyImageAnalysis;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 로그인 없이도 호출 가능 (모바일 안전 패널 — 매장 점주용) */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";
  if (!message && !imageDataUrl) return NextResponse.json({ error: "message or imageDataUrl required" }, { status: 400 });
  recordUsage("safety", imageDataUrl ? "image" : "qa"); // 실행 세부: 이미지 분석 vs 안전 QA
  const org = orgLabel((await getPlaygroundConfig()).orgName);

  // 이미지 첨부 분석: 멀티모달 LLM 호출도 가드레일 게이트웨이를 경유한다.
  if (imageDataUrl) {
    const userPrompt =
      message ||
      "매장 안전 관점에서 사진을 분석해 주세요. 위반사항, 관련 규정, 즉시 조치사항을 한국어로 간결하게 정리해 주세요.";
    const ctx = await buildGuardContext(req, "safety");
    try {
      const replyText = (
        await guardedChat({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt },
                { type: "image_url", image_url: { url: imageDataUrl } },
              ],
            },
          ],
          ctx,
          system:
            `당신은 ${org} 매장의 산업안전 점검 전문가입니다. 사진을 보고 반드시 JSON만 반환하세요. 스키마: {"riskLevel":"낮음|보통|높음|심각","summary":"한줄요약","violations":["..."],"regulations":["..."],"actions":["..."]}`,
          maxTokens: 1200,
          guardInput: userPrompt,
        })
      ).trim();
      const analysis = parseImageAnalysis(replyText);
      return NextResponse.json({ ok: true, reply: replyText, analysis });
    } catch (e) {
      if (isGuardBlockedError(e)) {
        return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
      }
      const msg = e instanceof Error ? e.message : "이미지 분석 실패";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }
  const ctx = await buildGuardContext(req, "safety");
  // 안전DB(107건) 키워드 검색 → 관련 Q&A를 【참고 자료】로 주입해 답변을 근거화(폐쇄망, 외부 호출 없음)
  const rag = retrieveSafetyContext(message);
  const userPrompt = rag.context
    ? `【참고 자료(매장 안전DB)】\n${rag.context}\n\n【질문】\n${message}`
    : message;
  try {
    const text = await guardedChat({
      messages: [{ role: "user", content: userPrompt }],
      ctx,
      system:
        `당신은 ${org} 매장 안전관리 전문가입니다. 매장 안전(전기·소방·주방·미끄러짐·배기·응급처치·고객응대 등) 관련 질문에만 한국어로 짧고 명확하게 답하세요. ` +
        "안전과 무관한 일반 상식·잡담·다른 분야 질문에는 답변하지 말고, '저는 매장 안전관리 관련 질문에만 답변할 수 있습니다. 안전 관련해 도와드릴 내용이 있을까요?'라고 정중히 안내하세요. " +
        "【참고 자료】가 주어지면 그 즉시 조치·주의사항·보고 내용을 우선 근거로 답하세요. " +
        "긴급·위험 상황이면 119/112 신고와 상급자 보고를 함께 안내하세요. 지어내지 말고 모르면 모른다고 하세요.",
      guardInput: message,
    });
    return NextResponse.json({ ok: true, reply: text.trim(), category: rag.matchedCategory ?? undefined });
  } catch (e) {
    if (isGuardBlockedError(e)) {
      return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    }
    const msg = e instanceof Error ? e.message : "LLM 호출 실패";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
