import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { QuizPoolModel } from "@/models/QuizPool";
import { isAdmin } from "@/lib/adminAuth";
import { validateQuizInput } from "@/lib/quiz";

export const dynamic = "force-dynamic";

/** PUT /api/quiz/pool/[id] — 문제 수정 (admin). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const r = validateQuizInput(body);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  await connectDb();
  const doc = await QuizPoolModel.findByIdAndUpdate(id, { $set: r.value }, { new: true });
  if (!doc) return NextResponse.json({ error: "문제를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/quiz/pool/[id] — 문제 삭제 (admin). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  await connectDb();
  const doc = await QuizPoolModel.findByIdAndDelete(id);
  if (!doc) return NextResponse.json({ error: "문제를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
