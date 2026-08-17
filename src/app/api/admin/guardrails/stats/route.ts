import { NextResponse } from "next/server";
import { PipelineStage } from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { AuditLogModel } from "@/models/AuditLog";

export const dynamic = "force-dynamic";

// 일자 버킷은 KST 기준($dateToString timezone과 일치). 한국 내부망 운영 전제.
const TZ = "Asia/Seoul";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayKey = (d: Date): string => dayFmt.format(d); // "YYYY-MM-DD"

type Grp = { _id: string | null; count: number };
type GrpLat = { _id: string | null; count: number; latency: number };
type DayGrp = { _id: { day: string; outcome: string }; count: number };
type Facet = {
  summary: GrpLat[];
  byDay: DayGrp[];
  byPanel: Grp[];
  byRule: Grp[];
  byStage: Grp[];
  topUsers: Grp[];
  byMask: Grp[];
};

/** GET /api/admin/guardrails/stats?days=7 | from&to [&outcome] — 감사 로그 집계(admin 전용). DB 집계로 요약만 반환. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  let since: Date;
  let until: Date;
  let days: number;
  let rangeMode = false;
  if (isDate(fromParam) && isDate(toParam) && fromParam <= toParam) {
    rangeMode = true;
    since = new Date(`${fromParam}T00:00:00`);
    until = new Date(`${toParam}T23:59:59.999`);
    days = Math.min(366, Math.round((new Date(`${toParam}T00:00:00`).getTime() - since.getTime()) / 86_400_000) + 1);
  } else {
    days = Math.min(366, Math.max(1, parseInt(searchParams.get("days") ?? "7", 10) || 7));
    since = new Date(Date.now() - days * 86_400_000);
    until = new Date();
  }

  // 분포·추세는 선택 outcome으로 필터(요약 카드는 전체). 단일-outcome 패싯은 필터와 교집합(불일치면 빈 결과).
  const outcomeFilter = ["blocked", "error", "pass"].includes(searchParams.get("outcome") ?? "")
    ? (searchParams.get("outcome") as "blocked" | "error" | "pass")
    : null;
  const NEVER: PipelineStage.FacetPipelineStage[] = [{ $match: { outcome: "__never__" } }];
  const filt: PipelineStage.FacetPipelineStage[] = outcomeFilter ? [{ $match: { outcome: outcomeFilter } }] : [];
  const onlyOutcome = (oc: "pass" | "blocked" | "error"): PipelineStage.FacetPipelineStage[] =>
    !outcomeFilter || outcomeFilter === oc ? [{ $match: { outcome: oc } }] : NEVER;
  const ruleOcs = (["blocked", "error"] as const).filter((o) => !outcomeFilter || outcomeFilter === o);
  const ruleStage: PipelineStage.FacetPipelineStage[] = ruleOcs.length ? [{ $match: { outcome: { $in: ruleOcs } } }] : NEVER;

  await connectDb();

  // 시간창을 인덱스로 1차 축소 → $facet에서 분포·추세를 한 번에 집계. 행 전체를 메모리로 로드하지 않음.
  const pipeline: PipelineStage[] = [
    { $match: { createdAt: { $gte: since, $lte: until } } },
    {
      $facet: {
        summary: [{ $group: { _id: "$outcome", count: { $sum: 1 }, latency: { $sum: { $ifNull: ["$latencyMs", 0] } } } }],
        byDay: [
          ...filt,
          { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ } }, outcome: "$outcome" }, count: { $sum: 1 } } },
        ],
        byPanel: [...filt, { $group: { _id: "$panel", count: { $sum: 1 } } }],
        byRule: [
          ...ruleStage,
          { $project: { key: { $cond: [{ $eq: ["$outcome", "error"] }, "model-error", { $arrayElemAt: [{ $split: [{ $ifNull: ["$ruleId", "unknown"] }, ":"] }, 0] }] } } },
          { $group: { _id: "$key", count: { $sum: 1 } } },
        ],
        byStage: [...onlyOutcome("blocked"), { $group: { _id: { $ifNull: ["$stage", "unknown"] }, count: { $sum: 1 } } }],
        topUsers: [
          ...onlyOutcome("blocked"),
          { $group: { _id: { $ifNull: ["$userId", { $ifNull: ["$ip", "unknown"] }] }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
        byMask: [...onlyOutcome("pass"), { $unwind: "$maskedTypes" }, { $group: { _id: "$maskedTypes", count: { $sum: 1 } } }],
      },
    },
  ];
  const rows = await AuditLogModel.aggregate<Facet>(pipeline);
  const f: Facet = rows[0] ?? { summary: [], byDay: [], byPanel: [], byRule: [], byStage: [], topUsers: [], byMask: [] };

  const sumBy: Record<string, { count: number; latency: number }> = {};
  for (const s of f.summary) sumBy[String(s._id)] = { count: s.count, latency: s.latency };
  const passed = sumBy.pass?.count ?? 0;
  const blockedN = sumBy.blocked?.count ?? 0;
  const erroredN = sumBy.error?.count ?? 0;
  const total = passed + blockedN + erroredN;
  const latencySum = (sumBy.pass?.latency ?? 0) + (sumBy.blocked?.latency ?? 0) + (sumBy.error?.latency ?? 0);

  // 일별 추세: 범위 내 모든 날짜를 0으로 초기화 후 채움(KST 일자).
  const byDay = new Map<string, { pass: number; blocked: number }>();
  if (rangeMode) {
    for (let i = 0; i < days; i++) byDay.set(dayKey(new Date(since.getTime() + i * 86_400_000)), { pass: 0, blocked: 0 });
  } else {
    for (let i = days - 1; i >= 0; i--) byDay.set(dayKey(new Date(Date.now() - i * 86_400_000)), { pass: 0, blocked: 0 });
  }
  for (const g of f.byDay) {
    const e = byDay.get(g._id.day);
    if (!e) continue;
    if (g._id.outcome === "pass") e.pass += g.count;
    else if (g._id.outcome === "blocked") e.blocked += g.count;
  }

  const toArr = (rs: Grp[]) => rs.map((r) => ({ key: r._id ?? "unknown", count: r.count })).sort((a, b) => b.count - a.count);

  return NextResponse.json({
    ok: true,
    days,
    summary: {
      total,
      passed,
      blocked: blockedN,
      errored: erroredN,
      blockRate: total === 0 ? 0 : Number(((blockedN / total) * 100).toFixed(1)),
      avgLatencyMs: total === 0 ? 0 : Math.round(latencySum / total),
    },
    trend: [...byDay.entries()].map(([day, v]) => ({ day, pass: v.pass, blocked: v.blocked })),
    byRule: toArr(f.byRule),
    byPanel: toArr(f.byPanel),
    byStage: toArr(f.byStage),
    topUsers: toArr(f.topUsers),
    byMaskType: toArr(f.byMask),
  });
}
