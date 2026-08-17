import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { AdIndustryRuleModel } from "@/models/AdIndustryRule";
import { invalidateAdRulesCache } from "@/lib/ad-rules";

export const dynamic = "force-dynamic";

const STR_ARR_FIELDS = ["riskExpressions", "requiredNotices", "attachments", "rejections"] as const;

/** GET — 업종별 룰셋 전체 (admin). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectDb();
  const rules = await AdIndustryRuleModel.find({}).sort({ sortOrder: 1 }).lean();
  return NextResponse.json({ ok: true, rules: rules.map((r) => ({ ...r, _id: String(r._id) })) });
}

/** POST — 신규 업종 룰 (admin). */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const industry = typeof body?.industry === "string" ? body.industry.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  if (!industry || !category) {
    return NextResponse.json({ error: "industry·category는 필수입니다." }, { status: 400 });
  }
  await connectDb();
  const exists = await AdIndustryRuleModel.findOne({ industry }).lean();
  if (exists) return NextResponse.json({ error: "이미 존재하는 업종입니다." }, { status: 409 });

  const doc = {
    industry,
    category,
    highRisk: body?.highRisk === true,
    banned: body?.banned === true,
    basis: typeof body?.basis === "string" ? body.basis : "",
    note: typeof body?.note === "string" ? body.note : "",
    sortOrder: typeof body?.sortOrder === "number" ? body.sortOrder : 999,
    ...Object.fromEntries(
      STR_ARR_FIELDS.map((f) => [f, Array.isArray(body?.[f]) ? (body![f] as unknown[]).filter((x) => typeof x === "string") : []]),
    ),
  };
  const created = await AdIndustryRuleModel.create(doc);
  invalidateAdRulesCache();
  return NextResponse.json({ ok: true, id: String(created._id) }, { status: 201 });
}
