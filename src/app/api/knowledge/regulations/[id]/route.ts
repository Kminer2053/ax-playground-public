import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";

export const dynamic = "force-dynamic";

/** GET /api/knowledge/regulations/[id] — 규정 상세(조문 목록). 지식검색 출처 팝업용(P5). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  await connectDb();
  const doc = await RagRegulationModel.findById(id)
    .select("title year articles")
    .lean<{ title: string; year?: string; articles?: { name: string; fullText?: string; order?: number }[] } | null>();
  if (!doc) return NextResponse.json({ error: "규정을 찾을 수 없습니다." }, { status: 404 });
  const articles = (doc.articles || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((a) => ({ name: a.name, fullText: a.fullText || "" }));
  recordUsage("knowledge", "source"); // 답변 출처 확인(근거 원문 열기)
  return NextResponse.json({ ok: true, title: doc.title, year: doc.year || "", articles });
}
