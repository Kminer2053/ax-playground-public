import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";

/** 적재 문서 건수 조회 — UI 표시용. count=내부 사규(하위호환), external=법령·행정규칙 등 외부 규범 */
const EXTERNAL_CATS = ["법령", "행정규칙", "외부"];

export async function GET() {
  await connectDb();
  const [internal, external] = await Promise.all([
    RagRegulationModel.countDocuments({ category: { $nin: EXTERNAL_CATS } }),
    RagRegulationModel.countDocuments({ category: { $in: EXTERNAL_CATS } }),
  ]);
  return NextResponse.json({ count: internal, internal, external });
}
