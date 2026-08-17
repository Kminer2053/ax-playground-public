import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { queryTermsFromQuestion, ragRegulationTextBlob, termMatchRatio } from "@/lib/regulations-rag";
import { recordUsage } from "@/lib/usage";

type LeanReg = {
  title?: string;
  year?: string;
  content?: string;
  score?: number;
};

/**
 * 사규 검색: 참조 리포와 동일하게 $text + 키워드 하이브리드(임베딩 없음).
 */
export async function POST(req: Request) {

  let body: { q?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const q = typeof body.q === "string" ? body.q.trim() : "";
  const limit = typeof body.limit === "number" && body.limit > 0 && body.limit <= 20 ? body.limit : 10;
  if (!q) {
    return NextResponse.json({ error: "검색어(q)를 보내 주세요." }, { status: 400 });
  }

  await connectDb();

  const hybrid = (await retrieveRagRegulationsForQa(q, Math.max(limit * 2, 12))) as LeanReg[];
  const terms = queryTermsFromQuestion(q);

  const ranked = hybrid
    .map((r) => {
      const b = ragRegulationTextBlob({ title: r.title, year: r.year, content: r.content });
      const tr = termMatchRatio(b, terms);
      return { r, tr };
    })
    .sort((a, b) => b.tr - a.tr)
    .slice(0, limit)
    .map((x) => x.r);

  const regulations = ranked.map((r) => ({
    title: r.title,
    revisionInfo: r.year ?? "",
    year: r.year ?? "",
    content: r.content,
    score: (r as { score?: number }).score ?? null,
  }));

  recordUsage("knowledge", "search"); // 사규 목록검색(브라우저) 실행 — AI 답변 경로(fast/deep)와 구분
  return NextResponse.json({
    ok: true,
    source: "text-hybrid",
    regulations,
  });
}
