import { saveFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

/**
 * POST /api/knowledge/feedback (multipart/form-data)
 *  지식검색 답변 만족도 피드백. 공용 saveFeedback(panel="knowledge")에 위임.
 *  (문서작성·안전·민원·도안 등 생성형 패널은 /api/feedback 사용 — 동일 스키마)
 */
export async function POST(req: Request) {
  return saveFeedback(req, "knowledge");
}
