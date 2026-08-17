import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";

export const dynamic = "force-dynamic";

/**
 * POST /api/knowledge/regulations/view  { title }
 * 사규 열람 시 조회수 누적(자주 찾는 사규 산정). title은 정제 제목(개정정보 제외).
 * 무로그인·집계용이라 fire-and-forget. 실패해도 UI 영향 없음.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { title?: string } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await connectDb();
    await RagRegulationModel.updateOne({ title }, { $inc: { views: 1 } });
  } catch {
    /* 집계 실패는 무시 */
  }
  recordUsage("knowledge", "view"); // 사규 원문 열람
  return NextResponse.json({ ok: true });
}
