import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import { RagRegulationModel } from "@/models/RagRegulation";
import { connectDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/knowledge/doc?title=<문서 제목> — 지식그래프 노드 원문 팝업(무로그인 공개).
 * 적재 문서(사규·법령·행정규칙) 전문을 조문 단위로 반환.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const title = (url.searchParams.get("title") ?? "").trim();
  if (!title) return NextResponse.json({ error: "title 필수" }, { status: 400 });
  await connectDb();

  const d = await RagRegulationModel.findOne({ title }, { title: 1, category: 1, year: 1, articles: 1 })
    .lean<{ title: string; category?: string; year?: string; articles?: { name: string; fullText?: string }[] }>();
  if (!d) return NextResponse.json({ error: "문서 없음" }, { status: 404 });

  const articles = (d.articles ?? [])
    .filter((a) => a.name && a.fullText)
    .map((a) => ({ name: a.name, fullText: a.fullText as string }));

  recordUsage("knowledge", "graph"); // 지식그래프 노드 원문 팝업
  return NextResponse.json({ title: d.title, category: d.category ?? "", year: d.year ?? "", articles });
}
