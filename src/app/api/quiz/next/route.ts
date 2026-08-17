import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { QuizPoolModel } from "@/models/QuizPool";
import { shuffle } from "@/lib/quiz";

export const dynamic = "force-dynamic";

/**
 * GET /api/quiz/next?exclude=id1,id2 — 미출제 문제 랜덤 1건(보기 셔플).
 * 풀 소진 시 { exhausted: true }.
 */
export async function GET(req: Request) {
  await connectDb();
  const { searchParams } = new URL(req.url);
  const exclude = (searchParams.get("exclude") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => Types.ObjectId.isValid(s))
    .map((s) => new Types.ObjectId(s));

  const match = exclude.length ? { _id: { $nin: exclude } } : {};
  const docs = await QuizPoolModel.aggregate([{ $match: match }, { $sample: { size: 1 } }]);
  if (!docs.length) return NextResponse.json({ exhausted: true });

  const d = docs[0] as { _id: Types.ObjectId; question: string; choices: string[]; answerIndex: number; explanation?: string };
  // 보기 셔플(정답 위치 추적). 사내 재미 게임이라 판정은 클라이언트에서.
  const order = shuffle(d.choices.map((_, i) => i));
  const choices = order.map((i) => d.choices[i]);
  const answerIndex = order.indexOf(d.answerIndex);

  return NextResponse.json({
    id: String(d._id),
    question: d.question,
    choices,
    answerIndex,
    explanation: d.explanation || "",
  });
}
