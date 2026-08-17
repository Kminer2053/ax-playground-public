import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { QuizPoolModel } from "@/models/QuizPool";
import { isAdmin } from "@/lib/adminAuth";
import { validateQuizInput } from "@/lib/quiz";

export const dynamic = "force-dynamic";

/** POST /api/quiz/pool/bulk — CSV/엑셀 일괄 등록 (admin). body: { items: [{question, choices[], answerIndex, explanation?}] } */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  if (!body || !Array.isArray(body.items)) return NextResponse.json({ error: "items 배열이 필요합니다." }, { status: 400 });
  if (body.items.length > 1000) return NextResponse.json({ error: "한 번에 최대 1000건까지 등록할 수 있습니다." }, { status: 400 });

  const valid: object[] = [];
  const errors: { row: number; error: string }[] = [];
  body.items.forEach((item, i) => {
    const r = validateQuizInput(item);
    if ("error" in r) errors.push({ row: i + 1, error: r.error });
    else valid.push(r.value);
  });
  if (valid.length === 0) return NextResponse.json({ error: "유효한 문제가 없습니다.", errors }, { status: 400 });

  await connectDb();
  await QuizPoolModel.insertMany(valid);
  return NextResponse.json({ ok: true, added: valid.length, skipped: errors.length, errors });
}
