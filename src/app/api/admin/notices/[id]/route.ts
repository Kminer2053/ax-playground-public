/** 공지 수정·삭제(admin). */
import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { NoticeModel } from "@/models/Notice";
import { deleteUploadByUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

const toDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  await connectDb();
  const set: Record<string, unknown> = {};
  if (typeof b.title === "string") set.title = b.title.trim();
  if (typeof b.content === "string") set.content = b.content.trim();
  if (typeof b.imageUrl === "string") set.imageUrl = b.imageUrl.trim();
  if (typeof b.isActive === "boolean") set.isActive = b.isActive;
  if ("startAt" in b) set.startAt = toDate(b.startAt);
  if ("endAt" in b) set.endAt = toDate(b.endAt);
  if ("pinned" in b) set.pinned = Number(b.pinned) || 0;
  if (!Object.keys(set).length) return NextResponse.json({ error: "변경할 내용이 없습니다." }, { status: 400 });

  // updatedAt이 갱신돼야 이미 닫은 사용자에게 다시 뜬다(모델 주석 참조).
  const r = await NoticeModel.findByIdAndUpdate(id, { $set: set }, { new: true, timestamps: true });
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  await connectDb();
  const r = await NoticeModel.findByIdAndDelete(id).lean<{ imageUrl?: string } | null>();
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // 남은 이미지 파일 정리 — 실패해도 삭제 자체는 성공으로 둔다(best-effort).
  if (r.imageUrl) await deleteUploadByUrl(r.imageUrl);
  return NextResponse.json({ ok: true });
}
