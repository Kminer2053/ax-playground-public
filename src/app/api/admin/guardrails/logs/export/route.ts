import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { AuditLogModel } from "@/models/AuditLog";
import { csvCell as cell } from "@/lib/csv";

export const dynamic = "force-dynamic";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

const MAX_ROWS = 20000;

/**
 * GET /api/admin/guardrails/logs/export?outcome=&panel=&from=&to=&days=
 * 감사 로그를 입력·생성 텍스트까지 포함한 CSV 파일로 다운로드(admin 전용·보안 추적용).
 * 목록 라우트와 동일한 필터를 적용. inputText/outputText 는 전문 기록이 켜진 경우에만 채워진다.
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return new Response("unauthorized", { status: 401 });

  const sp = new URL(req.url).searchParams;
  const query: Record<string, unknown> = {};
  const outcome = sp.get("outcome");
  if (outcome === "blocked" || outcome === "error" || outcome === "pass") query.outcome = outcome;
  const panel = sp.get("panel");
  if (panel) query.panel = panel;
  const from = sp.get("from");
  const to = sp.get("to");
  if (isDate(from) && isDate(to) && from <= to) {
    query.createdAt = { $gte: new Date(`${from}T00:00:00`), $lte: new Date(`${to}T23:59:59.999`) };
  } else if (sp.get("days")) {
    const days = Math.min(366, Math.max(1, parseInt(sp.get("days") ?? "", 10) || 7));
    query.createdAt = { $gte: new Date(Date.now() - days * 86_400_000) };
  }

  await connectDb();
  const docs = await AuditLogModel.find(query)
    .select("createdAt outcome stage ruleId panel userId ip maskedTypes latencyMs inputLen outputLen inputText outputText")
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS)
    .lean<
      Array<{
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
        inputText: string | null;
        outputText: string | null;
      }>
    >()
    .exec();

  const head = ["시각(UTC)", "결과", "패널", "단계", "룰/사유ID", "사용자", "IP", "마스킹", "지연ms", "입력자수", "출력자수", "입력텍스트", "생성텍스트"];
  const lines = [head.join(",")];
  for (const d of docs) {
    lines.push(
      [
        new Date(d.createdAt).toISOString(),
        d.outcome,
        d.panel,
        d.stage ?? "",
        d.ruleId ?? "",
        d.userId ?? "",
        d.ip ?? "",
        (d.maskedTypes ?? []).join("|"),
        d.latencyMs,
        d.inputLen,
        d.outputLen,
        d.inputText ?? "",
        d.outputText ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }
  // BOM + CRLF: Excel 한글·개행 호환.
  const csv = "﻿" + lines.join("\r\n");
  const tag = outcome || "all";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="guardrail_audit_${tag}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
