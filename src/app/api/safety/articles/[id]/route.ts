import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { SafetyArticleModel } from "@/models/SafetyArticle";
import { canManageSafety, sanitizeAttachments } from "@/lib/safety";

export const dynamic = "force-dynamic";

/** PATCH /api/safety/articles/[id] — 게시물 수정 (관리자 또는 게시판 비밀번호). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  if (!(await canManageSafety(typeof body.password === "string" ? body.password : ""))) {
    return NextResponse.json({ error: "권한이 없습니다. 관리 비밀번호를 확인하세요." }, { status: 401 });
  }
  const set: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) set.title = body.title.trim();
  if (typeof body.content === "string" && body.content.trim()) set.content = body.content.trim();
  if (body.type === "news" || body.type === "library") set.type = body.type;
  if (typeof body.imageUrl === "string") set.imageUrl = body.imageUrl;
  if (Array.isArray(body.attachments)) set.attachments = sanitizeAttachments(body.attachments);
  if (!Object.keys(set).length) return NextResponse.json({ error: "변경할 내용이 없습니다." }, { status: 400 });
  await connectDb();
  const doc = await SafetyArticleModel.findByIdAndUpdate(id, { $set: set }, { new: true });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/safety/articles/[id] — 게시물 삭제 (관리자 또는 게시판 비밀번호). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  if (!(await canManageSafety(typeof body.password === "string" ? body.password : ""))) {
    return NextResponse.json({ error: "권한이 없습니다. 관리 비밀번호를 확인하세요." }, { status: 401 });
  }
  await connectDb();
  const doc = await SafetyArticleModel.findByIdAndDelete(id);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
