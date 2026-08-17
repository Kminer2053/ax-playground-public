/**
 * 지금 띄울 공지 — 무로그인 공개 조회.
 *
 * 활성이고 게시 기간 안에 있는 것만 준다. 기간 판정을 브라우저에 맡기면 사용자 시계가
 * 틀어졌을 때 지난 공지가 뜨므로 서버에서 거른다.
 */
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { NoticeModel } from "@/models/Notice";

export const dynamic = "force-dynamic";

export async function GET() {
  await connectDb();
  const now = new Date();
  const items = (await NoticeModel.find({
    isActive: true,
    $and: [
      { $or: [{ startAt: null }, { startAt: { $exists: false } }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $exists: false } }, { endAt: { $gte: now } }] },
    ],
  })
    .sort({ pinned: -1, createdAt: -1 })
    .limit(5)
    .select("title content imageUrl updatedAt createdAt")
    .lean()) as unknown as { _id: unknown; title: string; content: string; imageUrl?: string; updatedAt?: Date; createdAt?: Date }[];

  return NextResponse.json({
    ok: true,
    items: items.map((n) => ({
      id: String(n._id),
      title: n.title,
      content: n.content,
      imageUrl: n.imageUrl || "",
      // 다시 띄울지 판정하는 키 — 내용을 고치면 값이 바뀌어 자동으로 다시 보인다.
      rev: new Date(n.updatedAt ?? n.createdAt ?? 0).getTime(),
      date: (n.createdAt ?? new Date()).toISOString().slice(0, 10),
    })),
  });
}
