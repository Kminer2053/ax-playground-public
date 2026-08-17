import type { NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import { connectDb } from "@/lib/db";
import { buildGuardContext } from "@/lib/guardrails";
import { saveUpload } from "@/lib/upload";
import { SearchFeedbackModel } from "@/models/SearchFeedback";

/** 만족도 피드백을 지원하는 패널(지식검색 + 생성형 4패널). 관리자 분석의 그룹 키. */
export const FEEDBACK_PANELS = ["knowledge", "docs", "safety", "cs", "ad"] as const;
export type FeedbackPanel = (typeof FEEDBACK_PANELS)[number];
export function isFeedbackPanel(v: string): v is FeedbackPanel {
  return (FEEDBACK_PANELS as readonly string[]).includes(v);
}

/**
 * 만족도 피드백 저장(공용) — 지식검색·문서작성·안전관리·민원답변·도안심의 공유.
 * multipart/form-data: rating(up|down) · question · answer · mode · intent · citations(JSON)
 *   · usedVector/usedGraph(1) · reason(👎) · image(👎, 선택). 무로그인이라 익명(clientId/ip)만 기록.
 * panel별로 question/answer의 의미가 다르다(안전=질문·이미지/진단결과, 도안=업종/심의결과 등) —
 * 저장 스키마는 동일하고 관리자 분석에서 panel로 구분한다.
 */
export async function saveFeedback(req: Request, panel: FeedbackPanel): Promise<NextResponse> {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return Res.json({ error: "multipart/form-data 형식이 필요합니다." }, { status: 400 }); }

  const rating = String(form.get("rating") || "");
  if (rating !== "up" && rating !== "down") {
    return Res.json({ error: "rating(up|down)이 필요합니다." }, { status: 400 });
  }

  const ctx = await buildGuardContext(req, panel);

  let imageUrl = "";
  const file = form.get("image");
  if (file instanceof File && file.size > 0) {
    try { imageUrl = (await saveUpload(file, "image", "feedback")).url; }
    catch (e) { return Res.json({ error: e instanceof Error ? e.message : "이미지 업로드 실패" }, { status: 400 }); }
  }

  const citations = (() => {
    try { const v = JSON.parse(String(form.get("citations") || "[]")); return Array.isArray(v) ? v.slice(0, 20).map(String) : []; }
    catch { return []; }
  })();

  await connectDb();
  await SearchFeedbackModel.create({
    panel,
    rating,
    question: String(form.get("question") || "").slice(0, 2000),
    answer: String(form.get("answer") || "").slice(0, 8000),
    mode: String(form.get("mode") || "").slice(0, 20),
    intent: String(form.get("intent") || "").slice(0, 500),
    citations,
    usedVector: String(form.get("usedVector") || "") === "1",
    usedGraph: String(form.get("usedGraph") || "") === "1",
    reason: String(form.get("reason") || "").slice(0, 2000),
    imageUrl,
    day: new Date().toISOString().slice(0, 10),
    clientId: ctx.clientId ?? null,
    ip: ctx.ip ?? null,
  });

  return Res.json({ ok: true });
}
