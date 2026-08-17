import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import { RagRegulationModel } from "@/models/RagRegulation";
import { connectDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/work100/article?doc=<규정명>&name=<조문명> — 온톨로지 패널 "원문 보기"(무로그인 공개).
 * 온톨로지 evidence 앵커(doc·name)로 조문 원문을 직행 조회. 외부규범(법령·행정규칙)도
 * 적재분은 그대로 표출(category 배지용 반환).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const doc = (url.searchParams.get("doc") ?? "").trim();
  const name = (url.searchParams.get("name") ?? "").trim();
  if (!doc || !name) return NextResponse.json({ error: "doc·name 필수" }, { status: 400 });
  await connectDb();

  const d = await RagRegulationModel.findOne({ title: doc }, { title: 1, category: 1, year: 1, articles: 1 })
    .lean<{ title: string; category?: string; year?: string; articles?: { name: string; fullText?: string }[] }>();
  if (!d) return NextResponse.json({ error: "규정 없음" }, { status: 404 });

  // 정확 일치 → 접두 일치(별표 표기 변형 완충) 순
  const arts = d.articles ?? [];
  const hit = arts.find((a) => a.name === name) ?? arts.find((a) => a.name.startsWith(name.slice(0, 8)) && name.startsWith(a.name.slice(0, 8)));
  if (!hit?.fullText) return NextResponse.json({ error: "조문 없음" }, { status: 404 });

  recordUsage("knowledge", "workdoc"); // 업무 근거 조문 원문 보기
  return NextResponse.json({
    doc: d.title,
    category: d.category ?? "",
    year: d.year ?? "",
    name: hit.name,
    fullText: hit.fullText,
  });
}
