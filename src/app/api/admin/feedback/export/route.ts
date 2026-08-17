import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { SearchFeedbackModel } from "@/models/SearchFeedback";
import { isFeedbackPanel } from "@/lib/feedback";
import { csvCell } from "@/lib/csv";

export const dynamic = "force-dynamic";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** GET /api/admin/feedback/export?panel=&days=30&mode=&status= — 불만족 의견(👎) CSV 다운로드. admin. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return new Response("unauthorized", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from"), to = sp.get("to");
  let sinceDay: string, untilDay: string;
  if (isDate(from) && isDate(to) && from <= to) { sinceDay = from; untilDay = to; }
  else {
    const days = Math.min(Math.max(Number(sp.get("days")) || 30, 1), 365);
    const d = new Date(); untilDay = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() - (days - 1)); sinceDay = d.toISOString().slice(0, 10);
  }
  const mode = sp.get("mode"); const status = sp.get("status");
  const panelParam = sp.get("panel"); const panel = panelParam && isFeedbackPanel(panelParam) ? panelParam : "knowledge";
  await connectDb();
  const q: Record<string, unknown> = { panel, rating: "down", day: { $gte: sinceDay, $lte: untilDay } };
  if (panel === "knowledge" && (mode === "fast" || mode === "deep")) q.mode = mode;
  if (["new", "reviewed", "resolved"].includes(status || "")) q.status = status;
  const rows = await SearchFeedbackModel.find(q).sort({ createdAt: -1 }).limit(5000).lean();

  const header = ["일시", "모드", "질문", "사유", "인용사규", "참고이미지", "상태"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows as Record<string, unknown>[]) {
    lines.push([
      (r.createdAt as Date)?.toISOString?.() ?? r.day, r.mode, r.question, r.reason,
      Array.isArray(r.citations) ? (r.citations as string[]).join(" / ") : "", r.imageUrl, r.status,
    ].map(csvCell).join(","));
  }
  return new Response("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="search-feedback-${sinceDay}_${untilDay}.csv"`,
    },
  });
}
