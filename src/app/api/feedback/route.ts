import { NextResponse } from "next/server";
import { saveFeedback, isFeedbackPanel } from "@/lib/feedback";

export const dynamic = "force-dynamic";

/**
 * POST /api/feedback (multipart/form-data) — 생성형 패널 공용 만족도 피드백.
 *  panel(docs|safety|cs|ad) + rating(up|down) + question/answer/reason/image 등.
 *  지식검색은 /api/knowledge/feedback(동일 로직) 유지. 스키마·저장은 SearchFeedback 공유.
 */
export async function POST(req: Request) {
  const panel = String((await req.clone().formData().catch(() => new FormData())).get("panel") || "");
  if (!isFeedbackPanel(panel) || panel === "knowledge") {
    return NextResponse.json({ error: "유효한 panel(docs|safety|cs|ad)이 필요합니다." }, { status: 400 });
  }
  return saveFeedback(req, panel);
}
