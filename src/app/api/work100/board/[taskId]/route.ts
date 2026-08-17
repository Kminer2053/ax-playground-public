import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";

export const dynamic = "force-dynamic";

/**
 * GET /api/work100/board/[taskId] — 보드 렌더캐시(무로그인 공개).
 * 기본: JSON { svg, motionSvg, audit }(보드 모달이 인라인·SMIL 제어).
 * ?format=svg | ?format=motion → 원시 SVG(Content-Type: image/svg+xml) 직접 반환.
 *
 * staleRefs: 이 업무의 근거 중 개정으로 격리된 건수. 보드 내용은 생성 시점 근거로 만들어졌으므로
 * 근거가 어긋나면 흐름도도 낡았을 수 있다 — 감추지 않고 "근거 확인 필요"로 알린다.
 * 자동 재생성은 하지 않는다(LLM 생성물이라 검증 루프가 다시 필요하다).
 */
export async function GET(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId: raw } = await params;
  const taskId = decodeURIComponent(raw);
  const format = new URL(req.url).searchParams.get("format");
  await connectDb();

  const db = mongoose.connection?.db;
  if (!db) return NextResponse.json({ error: "DB 미연결" }, { status: 500 });
  const doc = await db.collection("work100_boards").findOne(
    { taskId },
    { projection: { _id: 0, svg: 1, motionSvg: 1, audit: 1, status: 1 } },
  );
  if (!doc?.svg) return NextResponse.json({ error: "보드 캐시 없음" }, { status: 404 });

  // 보드가 참조하는 근거 = 이 업무의 근거 엣지. 별도 저장본보다 조인이 항상 최신이다.
  const staleRefs = await db.collection(collectionName("ontologyEdges"))
    .countDocuments({ from: taskId, stale: { $ne: null } });

  if (format === "svg" || format === "motion") {
    const body = format === "motion" ? (doc.motionSvg ?? doc.svg) : doc.svg;
    return new NextResponse(body, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }

  recordUsage("knowledge", "board"); // 업무흐름도 열람
  return NextResponse.json({
    taskId,
    svg: doc.svg,
    motionSvg: doc.motionSvg ?? null,
    audit: doc.audit ?? null,
    status: doc.status ?? "candidate",
    staleRefs,
  });
}
