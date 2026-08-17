import { NextResponse } from "next/server";
import { guardedChat, buildGuardContext, isGuardBlockedError } from "@/lib/guardrails";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { orgLabel } from "@/lib/org";
import { recordUsage } from "@/lib/usage";
import { CAT, STATIONS } from "@/lib/marketAnalysis";

export const dynamic = "force-dynamic";

const CATSET = new Set<string>(CAT);
const STNSET = new Set<string>(STATIONS.map((s) => s.s));

/**
 * POST /api/sales/trend-nl — 업종별 매출트렌드 자연어 검색(LLM 의도 파싱 + 근거 답변).
 * 분석 데이터는 브라우저에 있으므로 클라이언트가 압축 통계(context)를 함께 전송 → 내부 LLM(guardedChat) 경유.
 * 수치·차트는 클라이언트의 결정적 엔진이 담당하고, 여기서는 의도 해석 + (주입 통계 기반) 답변 문장만 생성.
 * body: { q: string, context: string }
 */
const buildSystem = (org: string) =>
  `너는 ${org} "업종별 매출 트렌드" 화면의 자연어 질의 해석기다. 아래 [통계]만 근거로 (1) 질문을 의도 JSON으로 해석하고 (2) 한 줄 답변을 작성한다.\n` +
  `업종 목록: ${CAT.join(" | ")}\n` +
  `규칙:\n` +
  `- intent.cat: 위 업종 중 하나, 없으면 null\n` +
  `- intent.stations: [통계]의 '분석 가능 역'에 실제 있는 역명만(여러 개 가능, 없으면 [])\n` +
  `- intent.metric: "trend"|"up"|"down"|"share" 중 하나\n` +
  `- intent.period: "daily"|"month"|"year" 또는 null\n` +
  `- intent.compare: true|false (전년/역간 비교 의도)\n` +
  `- intent.years: 숫자 또는 null\n` +
  `- answer: [통계]에 실제 있는 수치만 사용한 한 문장(<b>강조</b>만 허용). 근거 수치가 없으면 일반 안내.\n` +
  `- [통계]에 없는 역·업종·수치는 절대 지어내지 마라.\n` +
  `- 출력은 JSON 객체 하나만(코드펜스·설명 없이): {"intent":{"cat":null,"stations":[],"years":null,"metric":"trend","period":null,"compare":false},"answer":"..."}`;

function parseJson(raw: string): Record<string, unknown> | null {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>; } catch { return null; }
}
/** <b>·</b> 외의 태그는 무력화(LLM 답변 XSS 방지). */
function sanitize(s: string): string { return s.replace(/<(?!\/?b>)/gi, "&lt;"); }

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { q?: string; context?: string } | null;
  const q = typeof body?.q === "string" ? body.q.trim() : "";
  const context = typeof body?.context === "string" ? body.context.slice(0, 8000) : "";
  if (!q) return NextResponse.json({ ok: false, error: "질의가 비어 있습니다." }, { status: 400 });

  const userContent = `[통계]\n${context}\n\n[질문]\n${q}`;
  const ctx = await buildGuardContext(req, "sales");
  const org = orgLabel((await getPlaygroundConfig()).orgName);
  let raw = "";
  try {
    raw = await guardedChat({ messages: [{ role: "user", content: userContent }], ctx, system: buildSystem(org), maxTokens: 700, temperature: 0.2, guardInput: q });
  } catch (e) {
    if (isGuardBlockedError(e)) return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    return NextResponse.json({ ok: false, error: "AI 해석에 실패했습니다." }, { status: 200 }); // 클라이언트가 규칙 파서로 폴백
  }
  recordUsage("sales", "trend"); // 자연어 추이질의

  const parsed = parseJson(raw);
  if (!parsed) return NextResponse.json({ ok: false, error: "응답 해석 실패" }, { status: 200 });
  const i = (parsed.intent ?? {}) as Record<string, unknown>;
  const cat = typeof i.cat === "string" && CATSET.has(i.cat) ? i.cat : null;
  const stations = Array.isArray(i.stations) ? (i.stations.filter((s) => typeof s === "string" && STNSET.has(s)) as string[]) : [];
  const metric = ["trend", "up", "down", "share"].includes(i.metric as string) ? (i.metric as string) : "trend";
  const period = ["daily", "month", "year"].includes(i.period as string) ? (i.period as string) : null;
  const years = typeof i.years === "number" ? i.years : null;
  const answer = typeof parsed.answer === "string" ? sanitize(parsed.answer.trim()).slice(0, 400) : "";

  return NextResponse.json({
    ok: true,
    intent: { cat, station: stations[0] ?? null, stations, years, metric, period, compare: !!i.compare },
    answer,
  });
}
