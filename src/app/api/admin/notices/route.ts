/** 공지 관리 — 목록 조회·신규 등록(admin). */
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { NoticeModel } from "@/models/Notice";

export const dynamic = "force-dynamic";

/** 빈 문자열은 "기간 제한 없음"이라 null로 저장한다 — 빈 문자열을 Date로 넣으면 Invalid Date가 된다. */
const toDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectDb();
  const items = await NoticeModel.find({}).sort({ pinned: -1, createdAt: -1 }).limit(200).lean();
  return NextResponse.json({
    ok: true,
    items: items.map((n) => ({
      id: String(n._id), title: n.title, content: n.content, imageUrl: n.imageUrl || "", isActive: n.isActive,
      startAt: n.startAt ? new Date(n.startAt).toISOString().slice(0, 10) : "",
      endAt: n.endAt ? new Date(n.endAt).toISOString().slice(0, 10) : "",
      pinned: n.pinned ?? 0,
      createdAt: n.createdAt, updatedAt: n.updatedAt,
    })),
  });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const title = String(b.title ?? "").trim();
  const content = String(b.content ?? "").trim();
  if (!title || !content) return NextResponse.json({ error: "제목과 내용은 필수입니다." }, { status: 400 });

  await connectDb();
  const doc = await new NoticeModel({
    title, content,
    imageUrl: String(b.imageUrl ?? "").trim(),
    isActive: b.isActive !== false,
    startAt: toDate(b.startAt), endAt: toDate(b.endAt),
    pinned: Number(b.pinned) || 0,
    createdBy: "admin",
  }).save();
  return NextResponse.json({ ok: true, id: String(doc._id) }, { status: 201 });
}
