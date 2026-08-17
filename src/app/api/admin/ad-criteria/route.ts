import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { AdReviewCriteriaModel } from "@/models/AdReviewCriteria";
import { invalidateAdRulesCache } from "@/lib/ad-rules";

export const dynamic = "force-dynamic";

/** GET — 공통 심의기준 + 금지광고 목록 (admin). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectDb();
  const doc = await AdReviewCriteriaModel.findOne({ key: "default" }).lean<{
    criteriaText?: string;
    prohibitedList?: string[];
  } | null>();
  return NextResponse.json({
    ok: true,
    criteriaText: doc?.criteriaText ?? "",
    prohibitedList: doc?.prohibitedList ?? [],
  });
}

/** PUT — 심의기준·금지광고 목록 저장 + 캐시 무효화 (admin). */
export async function PUT(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });

  const update: Record<string, unknown> = { key: "default" };
  if (typeof body.criteriaText === "string") update.criteriaText = body.criteriaText;
  if (Array.isArray(body.prohibitedList)) {
    update.prohibitedList = body.prohibitedList.filter((x) => typeof x === "string");
  }

  await connectDb();
  await AdReviewCriteriaModel.updateOne({ key: "default" }, { $set: update }, { upsert: true });
  invalidateAdRulesCache();
  return NextResponse.json({ ok: true });
}
