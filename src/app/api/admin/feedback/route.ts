import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { SearchFeedbackModel } from "@/models/SearchFeedback";
import { isFeedbackPanel } from "@/lib/feedback";

export const dynamic = "force-dynamic";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** GET /api/admin/feedback?panel=knowledge|docs|safety|cs|ad&days=30&mode=fast|deep&status=...&page=1
 *  패널별 만족도 통계(요약·추세·불만족 사규 Top·모드별) + 불만족 의견 목록(👎, 페이지네이션). admin.
 *  mode·citations(사규 Top) 통계는 지식검색 전용 — 다른 패널에선 생략(생성형은 mode/사규 개념 없음). */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;

  // 기간
  const from = sp.get("from"), to = sp.get("to");
  let sinceDay: string, untilDay: string;
  if (isDate(from) && isDate(to) && from <= to) { sinceDay = from; untilDay = to; }
  else {
    const days = Math.min(Math.max(Number(sp.get("days")) || 30, 1), 365);
    const d = new Date(); untilDay = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() - (days - 1)); sinceDay = d.toISOString().slice(0, 10);
  }
  const mode = sp.get("mode"); const modeFilter = mode === "fast" || mode === "deep" ? mode : null;
  const status = sp.get("status"); const statusFilter = ["new", "reviewed", "resolved"].includes(status || "") ? status : null;
  const panelParam = sp.get("panel"); const panel = panelParam && isFeedbackPanel(panelParam) ? panelParam : "knowledge";
  const isKnowledge = panel === "knowledge"; // mode·citations(사규) 통계는 지식검색 전용

  await connectDb();
  const range: Record<string, unknown> = { panel, day: { $gte: sinceDay, $lte: untilDay } };
  const base = modeFilter && isKnowledge ? { ...range, mode: modeFilter } : range;

  const [up, down, unhandled, trendAgg, topAgg, modeAgg, vecUsed, graphUsed] = await Promise.all([
    SearchFeedbackModel.countDocuments({ ...base, rating: "up" }),
    SearchFeedbackModel.countDocuments({ ...base, rating: "down" }),
    SearchFeedbackModel.countDocuments({ ...base, rating: "down", status: "new" }),
    SearchFeedbackModel.aggregate([{ $match: base }, { $group: { _id: { day: "$day", rating: "$rating" }, c: { $sum: 1 } } }]),
    SearchFeedbackModel.aggregate([{ $match: { ...base, rating: "down" } }, { $unwind: "$citations" }, { $group: { _id: "$citations", c: { $sum: 1 } } }, { $sort: { c: -1 } }, { $limit: 8 }]),
    SearchFeedbackModel.aggregate([{ $match: range }, { $group: { _id: { mode: "$mode", rating: "$rating" }, c: { $sum: 1 } } }]),
    SearchFeedbackModel.countDocuments({ ...base, usedVector: true }),
    SearchFeedbackModel.countDocuments({ ...base, usedGraph: true }),
  ]);

  // 일별 추세(빈 날 0 채움)
  const trendMap = new Map<string, { up: number; down: number }>();
  for (const r of trendAgg as { _id: { day: string; rating: string }; c: number }[]) {
    const e = trendMap.get(r._id.day) ?? { up: 0, down: 0 };
    if (r._id.rating === "up") e.up = r.c; else e.down = r.c;
    trendMap.set(r._id.day, e);
  }
  const trend: { day: string; up: number; down: number }[] = [];
  for (let d = new Date(sinceDay); d.toISOString().slice(0, 10) <= untilDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const e = trendMap.get(day) ?? { up: 0, down: 0 };
    trend.push({ day, up: e.up, down: e.down });
  }

  // 모드별 만족도
  const modeStat = { fast: { up: 0, down: 0 }, deep: { up: 0, down: 0 } } as Record<string, { up: number; down: number }>;
  for (const r of modeAgg as { _id: { mode: string; rating: string }; c: number }[]) {
    const m = r._id.mode === "deep" ? "deep" : "fast";
    if (r._id.rating === "up") modeStat[m].up += r.c; else modeStat[m].down += r.c;
  }
  const rate = (u: number, dn: number) => (u + dn ? Math.round((u / (u + dn)) * 100) : null);

  // 불만족 의견 목록(👎)
  const listQ: Record<string, unknown> = { ...base, rating: "down" };
  if (statusFilter) listQ.status = statusFilter;
  const page = Math.max(1, Number(sp.get("page")) || 1); const LIMIT = 20;
  const [rows, listTotal] = await Promise.all([
    SearchFeedbackModel.find(listQ).sort({ createdAt: -1 }).skip((page - 1) * LIMIT).limit(LIMIT).lean(),
    SearchFeedbackModel.countDocuments(listQ),
  ]);
  const list = (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r._id), day: r.day, createdAt: r.createdAt, question: r.question, answer: r.answer,
    reason: r.reason, imageUrl: r.imageUrl, mode: r.mode, intent: r.intent,
    citations: r.citations ?? [], status: r.status,
    usedVector: Boolean(r.usedVector), usedGraph: Boolean(r.usedGraph),
  }));

  return NextResponse.json({
    ok: true, panel, isKnowledge, range: { from: sinceDay, to: untilDay },
    summary: { total: up + down, up, down, satisfaction: rate(up, down), unhandled },
    trend,
    topCitations: isKnowledge ? (topAgg as { _id: string; c: number }[]).map((t) => ({ title: t._id, count: t.c })) : [],
    byMode: isKnowledge ? { fast: { ...modeStat.fast, rate: rate(modeStat.fast.up, modeStat.fast.down) }, deep: { ...modeStat.deep, rate: rate(modeStat.deep.up, modeStat.deep.down) } } : null,
    channelStat: isKnowledge ? { total: up + down, vector: vecUsed, graph: graphUsed } : null,
    list, page, listTotal, limit: LIMIT,
  });
}

/** PATCH /api/admin/feedback  { id, status } — 불만족 의견 처리상태 변경. admin. */
export async function PATCH(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = String(body?.id || ""); const status = String(body?.status || "");
  if (!id || !["new", "reviewed", "resolved"].includes(status)) {
    return NextResponse.json({ error: "id·status(new|reviewed|resolved) 필요" }, { status: 400 });
  }
  await connectDb();
  await SearchFeedbackModel.updateOne({ _id: id }, { $set: { status } });
  return NextResponse.json({ ok: true });
}
