import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { AdIndustryRuleModel } from "@/models/AdIndustryRule";
import { invalidateAdRulesCache } from "@/lib/ad-rules";

export const dynamic = "force-dynamic";

const STR_FIELDS = ["industry", "category", "basis", "note"] as const;
const ARR_FIELDS = ["riskExpressions", "requiredNotices", "attachments", "rejections"] as const;
const BOOL_FIELDS = ["highRisk", "banned"] as const;

/** PATCH — 업종 룰 수정 (admin). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });

  const update: Record<string, unknown> = {};
  for (const f of STR_FIELDS) if (typeof body[f] === "string") update[f] = body[f];
  for (const f of BOOL_FIELDS) if (typeof body[f] === "boolean") update[f] = body[f];
  for (const f of ARR_FIELDS) if (Array.isArray(body[f])) update[f] = (body[f] as unknown[]).filter((x) => typeof x === "string");
  if (typeof body.sortOrder === "number") update.sortOrder = body.sortOrder;

  await connectDb();
  const r = await AdIndustryRuleModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  invalidateAdRulesCache();
  return NextResponse.json({ ok: true });
}

/** DELETE — 업종 룰 삭제 (admin). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  await connectDb();
  const r = await AdIndustryRuleModel.findByIdAndDelete(id).lean();
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  invalidateAdRulesCache();
  return NextResponse.json({ ok: true });
}
