import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { LibraryPostModel } from "@/models/LibraryPost";
import { normalizeNickname } from "@/lib/nickname";
import { hashPassword } from "@/lib/postAuth";

export const dynamic = "force-dynamic";

/** POST /api/library/[id]/comments — 댓글 등록. body: { author?, content, password? } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const content = String(body?.content || "").trim();
  if (!content) return NextResponse.json({ error: "댓글 내용을 입력하세요." }, { status: 400 });
  const author = normalizeNickname(body?.author);
  const passwordHash = hashPassword(String(body?.password || ""));
  const cid = new Types.ObjectId();
  const createdAt = new Date();

  await connectDb();
  const res = await LibraryPostModel.updateOne(
    { _id: id },
    { $push: { comments: { _id: cid, author, content: content.slice(0, 1000), passwordHash, createdAt } } },
  );
  if (res.matchedCount === 0) return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({
    ok: true,
    comment: { id: String(cid), author, content: content.slice(0, 1000), createdAt, hasPassword: !!passwordHash },
  });
}
