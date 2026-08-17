import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { LibraryPostModel } from "@/models/LibraryPost";

export const dynamic = "force-dynamic";

/**
 * POST /api/library/[id]/vote — 좋아요/싫어요 (익명 voterId 중복·토글).
 * body: { dir: "up"|"down", voterId: string }
 * 같은 방향 재투표=취소, 반대 방향=변경. 응답: { up, down, my: "up"|"down"|null }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { dir?: unknown; voterId?: unknown } | null;
  const dir = body?.dir;
  const voterId = typeof body?.voterId === "string" ? body.voterId.slice(0, 64) : "";
  if (dir !== "up" && dir !== "down") return NextResponse.json({ error: "dir은 up|down" }, { status: 400 });
  if (!voterId) return NextResponse.json({ error: "voterId 필요" }, { status: 400 });

  await connectDb();
  // 현재 상태로 케이스 판정(토글/변경/신규). 쓰기는 해당 원소·카운터만 원자 연산으로 처리해
  // 동시 투표가 서로의 voters/카운트를 덮어쓰지 않게 한다(전체 문서 save 금지). 같은 사용자 더블클릭의 미세 경합은 허용.
  type VoteLean = { voters?: { id: string; dir: "up" | "down" }[]; up: number; down: number } | null;
  type Counts = { up: number; down: number } | null;
  const cur = await LibraryPostModel.findById(id).select("voters up down").lean<VoteLean>();
  if (!cur) return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });

  const existing = cur.voters?.find((v) => v.id === voterId);
  let my: "up" | "down" | null;
  let updated: Counts;

  if (!existing) {
    updated = await LibraryPostModel.findOneAndUpdate(
      { _id: id, "voters.id": { $ne: voterId } },
      { $push: { voters: { id: voterId, dir } }, $inc: { [dir]: 1 } },
      { new: true },
    ).select("up down").lean<Counts>();
    my = dir;
  } else if (existing.dir === dir) {
    updated = await LibraryPostModel.findOneAndUpdate(
      { _id: id, "voters.id": voterId },
      { $pull: { voters: { id: voterId } }, $inc: { [dir]: -1 } },
      { new: true },
    ).select("up down").lean<Counts>();
    my = null;
  } else {
    const oldDir = existing.dir;
    updated = await LibraryPostModel.findOneAndUpdate(
      { _id: id, voters: { $elemMatch: { id: voterId, dir: oldDir } } },
      { $set: { "voters.$[v].dir": dir }, $inc: { [oldDir]: -1, [dir]: 1 } },
      { new: true, arrayFilters: [{ "v.id": voterId }] },
    ).select("up down").lean<Counts>();
    my = dir;
  }

  // 조건 불일치(동시 변경 등)로 매칭 실패 시 최신값 재조회.
  const fresh = updated ?? (await LibraryPostModel.findById(id).select("up down").lean<Counts>());
  recordUsage("library", "vote"); // 추천/비추천
  return NextResponse.json({ ok: true, up: Math.max(0, fresh?.up ?? 0), down: Math.max(0, fresh?.down ?? 0), my });
}
