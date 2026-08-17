import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { AuditLogModel } from "@/models/AuditLog";

export const dynamic = "force-dynamic";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * GET /api/admin/guardrails/logs?page=1&limit=20&outcome=error&from=&to=&days=&panel=
 * 감사 로그 (admin 전용) — outcome(pass/blocked/error)·기간·패널 필터 + 페이지네이션.
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const limit = Math.min(5000, Math.max(1, parseInt(sp.get("limit") ?? "20", 10) || 20));
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const outcome = sp.get("outcome");
  const panel = sp.get("panel");

  const query: Record<string, unknown> = {};
  if (outcome === "blocked" || outcome === "error" || outcome === "pass") query.outcome = outcome;
  if (panel) query.panel = panel;

  // 기간: from/to(YYYY-MM-DD) 우선, 없으면 days.
  const from = sp.get("from");
  const to = sp.get("to");
  if (isDate(from) && isDate(to) && from <= to) {
    query.createdAt = { $gte: new Date(`${from}T00:00:00`), $lte: new Date(`${to}T23:59:59.999`) };
  } else if (sp.get("days")) {
    const days = Math.min(366, Math.max(1, parseInt(sp.get("days") ?? "", 10) || 7));
    query.createdAt = { $gte: new Date(Date.now() - days * 86_400_000) };
  }

  await connectDb();
  const total = await AuditLogModel.countDocuments(query);
  const logs = await AuditLogModel.find(query)
    .select("createdAt outcome stage ruleId panel userId ip maskedTypes latencyMs inputLen outputLen")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean<
      Array<{
        _id: unknown;
        createdAt: Date;
        outcome: string;
        stage: string | null;
        ruleId: string | null;
        panel: string;
        userId: string | null;
        ip: string | null;
        maskedTypes: string[];
        latencyMs: number;
        inputLen: number;
        outputLen: number;
      }>
    >()
    .exec();

  return NextResponse.json({
    ok: true,
    total,
    page,
    limit,
    count: logs.length,
    logs: logs.map((l) => ({
      id: String(l._id),
      at: new Date(l.createdAt).toISOString(),
      outcome: l.outcome,
      stage: l.stage,
      ruleId: l.ruleId,
      panel: l.panel,
      userId: l.userId,
      ip: l.ip,
      maskedTypes: l.maskedTypes ?? [],
      latencyMs: l.latencyMs,
      inputLen: l.inputLen,
      outputLen: l.outputLen,
    })),
  });
}
