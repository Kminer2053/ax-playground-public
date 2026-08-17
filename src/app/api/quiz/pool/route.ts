import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { QuizPoolModel } from "@/models/QuizPool";
import { isAdmin } from "@/lib/adminAuth";
import { validateQuizInput } from "@/lib/quiz";

export const dynamic = "force-dynamic";

/** GET /api/quiz/pool — 문제 전체 목록 (admin, 관리용). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectDb();
  const items = await QuizPoolModel.find().sort({ createdAt: -1 }).lean();
  return NextResponse.json({ ok: true, total: items.length, items });
}

/** POST /api/quiz/pool — 문제 추가 (admin). */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const r = validateQuizInput(body);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  await connectDb();
  const doc = await QuizPoolModel.create(r.value);
  return NextResponse.json({ ok: true, id: String(doc._id) });
}
