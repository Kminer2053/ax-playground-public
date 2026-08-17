import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { LibraryPostModel } from "@/models/LibraryPost";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";

export const dynamic = "force-dynamic";

const BOARDS = ["prompt", "video", "file"];

/** GET /api/library/popular?board=prompt — 기간 내 좋아요 상위 N. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const board = searchParams.get("board");
  if (!board || !BOARDS.includes(board)) return NextResponse.json({ error: "board는 prompt|video|file" }, { status: 400 });

  const cfg = await getPlaygroundConfig();
  const since = new Date(Date.now() - cfg.popularWindowDays * 86_400_000);

  await connectDb();
  const items = await LibraryPostModel.find({
    board,
    createdAt: { $gte: since },
    up: { $gte: cfg.popularMinLikes },
  })
    .sort({ up: -1, createdAt: -1 })
    .limit(cfg.popularCount)
    .select("title author thumbnailUrl up down board createdAt")
    .lean();

  return NextResponse.json({
    ok: true,
    windowDays: cfg.popularWindowDays,
    items: items.map((d) => ({ id: String((d as { _id: unknown })._id), ...d, _id: undefined })),
  });
}
