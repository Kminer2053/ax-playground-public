import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { getUsageSummary } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** GET /api/admin/usage?days=14 — 기능별·일별 사용 집계 (admin). */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const range =
    isDate(from) && isDate(to) && from <= to
      ? { from, to }
      : { days: Math.min(Math.max(Number(sp.get("days")) || 14, 1), 365) };
  const featuresParam = sp.get("features");
  const features = featuresParam ? featuresParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const summary = await getUsageSummary(range, features);
  return NextResponse.json({ ok: true, ...summary });
}
