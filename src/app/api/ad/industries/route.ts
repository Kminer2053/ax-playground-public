import { NextResponse } from "next/server";
import { getIndustryRules } from "@/lib/ad-rules";

export const dynamic = "force-dynamic";

/** GET /api/ad/industries — 심의 업종 선택용 목록(비민감: 업종명·분야만). */
export async function GET() {
  const rules = await getIndustryRules();
  return NextResponse.json({
    ok: true,
    industries: rules.map((r) => ({ industry: r.industry, category: r.category, highRisk: r.highRisk, banned: r.banned })),
  });
}
