import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";

export const dynamic = "force-dynamic";

/** "2024년도 8월 개정" / "2026-05-26" / "2025년도 9월 26일 개정" → 정렬용 timestamp(없으면 0) */
function revDate(year: string): number {
  if (!year) return 0;
  const iso = year.match(/(\d{4})[-.](\d{1,2})[-.](\d{1,2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const ko = year.match(/(\d{4})\s*년도?\s*(?:(\d{1,2})\s*월)?\s*(?:(\d{1,2})\s*일)?/);
  if (ko) return Date.UTC(+ko[1], ko[2] ? +ko[2] - 1 : 0, ko[3] ? +ko[3] : 1);
  return 0;
}

type Lean = { _id: unknown; title?: string; year?: string; category?: string; docNumber?: string; views?: number; metadata?: { articleCount?: number } };
type Highlights = { ok: true; recent: ReturnType<typeof pick>[]; popular: ReturnType<typeof pick>[]; popularReal: boolean };
const pick = (d: Lean) => ({ id: String(d._id), title: d.title ?? "", category: d.category ?? "", year: d.year ?? "", docNumber: d.docNumber ?? "" });

// PERF-003: 지식검색 진입마다 사규 전체를 로드·정렬하던 것을 TTL 캐시로 완화. recent는 year 문자열을
// JS로 파싱해 정렬하므로 DB 정렬이 불가(저장 정렬키 없음) → 전량 스캔은 불가피하나, 사규는 재적재 때만
// 바뀌므로 5분 캐시로 반복 로드를 제거한다(재적재 직후 최대 5분 지연 허용).
const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; body: Highlights } | null = null;

/**
 * GET /api/knowledge/regulations/highlights
 * - recent: 개정/시행일 최신순 상위 5 (실제 DB year 파싱)
 * - popular: 조회수(views) 상위 5. 조회 누적 전이면 조문수 많은 주요 사규로 폴백(popularReal=false)
 * - "사규" 목록이므로 외부 규범(법령·행정규칙)은 제외 — 법령 시행일이 최신순을 점령하는 것 방지
 */
const EXTERNAL_CATS = ["법령", "행정규칙", "외부"];

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return NextResponse.json(cache.body);

  await connectDb();
  const docs = await RagRegulationModel.find({ category: { $nin: EXTERNAL_CATS } })
    .select("title year category docNumber views metadata.articleCount").lean<Lean[]>();

  const recent = [...docs]
    .map((d) => ({ d, t: revDate(d.year ?? "") }))
    .filter((x) => x.t > 0)
    .sort((a, b) => b.t - a.t)
    .slice(0, 5)
    .map((x) => pick(x.d));

  const haveViews = docs.some((d) => (d.views ?? 0) > 0);
  const popular = haveViews
    ? [...docs].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5).map(pick)
    : [...docs].sort((a, b) => (b.metadata?.articleCount ?? 0) - (a.metadata?.articleCount ?? 0)).slice(0, 5).map(pick);

  const body: Highlights = { ok: true, recent, popular, popularReal: haveViews };
  cache = { at: now, body };
  return NextResponse.json(body);
}
