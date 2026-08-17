import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { LibraryPostModel } from "@/models/LibraryPost";
import { isAdmin } from "@/lib/adminAuth";
import { verifyPassword } from "@/lib/postAuth";

export const dynamic = "force-dynamic";

/** DELETE /api/library/[id]/comments/[cid] — 관리자 또는 댓글 비밀번호. body(optional): { password } */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(cid)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });

  await connectDb();
  const doc = await LibraryPostModel.findById(id).select("comments").lean();
  if (!doc) return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
  const comments = ((doc as { comments?: unknown }).comments || []) as Array<{ _id: Types.ObjectId; passwordHash?: string }>;
  const c = comments.find((x) => String(x._id) === cid);
  if (!c) return NextResponse.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });

  if (!(await isAdmin())) {
    const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
    if (!verifyPassword(String(body?.password || ""), c.passwordHash || "")) {
      return NextResponse.json({ error: "비밀번호가 일치하지 않습니다." }, { status: 403 });
    }
  }
  await LibraryPostModel.updateOne({ _id: id }, { $pull: { comments: { _id: new Types.ObjectId(cid) } } });
  return NextResponse.json({ ok: true });
}
