import mongoose from "mongoose";
import { RagRegulationModel } from "@/models/RagRegulation";
import { retrievalSearchTokens } from "@/lib/regulations-rag";

/**
 * 규정명 해석(resolve) — 사용자가 쓴 명칭 변형을 정식 문서 제목으로 결정적으로 매핑.
 * 실측 근거(내부 감사): 제목 공백 비일관("취업 규칙" vs "자산관리규정")으로 부분일치가 자주 실패하고,
 * 공백제거 정규화 시 103문서 제목 충돌 0건, 바이그램 매칭으로 축약 변형 10/10 구제.
 * 단계: 별칭사전(수동) → 정규화 완전일치 → 정규화 포함일치(유일할 때만) → 바이그램 최고점(임계+유일 승자).
 * 유일하지 않으면 null + 후보 반환 — 오라우팅("복무 규정"→임원복무만 히트) 방지의 안전측 설계.
 */

export type TitleResolve = { title: string | null; candidates: string[]; via: "alias" | "exact" | "substr" | "bigram" | "none" };

/** 정규화: 공백·괄호·낫표 제거(한글 유지). "취업 규칙"→"취업규칙" */
export function normTitle(s: string): string {
  return (s ?? "").replace(/[「」『』()\[\]]/g, "").replace(/\s+/g, "").trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 문자 바이그램 Dice 유사도(0~1) — 짧은 한글 명칭 변형에 강건. */
export function bigramSim(a: string, b: string): number {
  const A = bigrams(normTitle(a)), B = bigrams(normTitle(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

// ── 제목·별칭 캐시(5분) — 103문서 규모라 전량 메모리 보관이 저렴 ──
let cache: { titles: string[]; aliases: Map<string, string>; at: number } | null = null;
const TTL = 5 * 60 * 1000;

async function loadTitleIndex(): Promise<{ titles: string[]; aliases: Map<string, string> }> {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const rows = (await RagRegulationModel.find({}).select({ title: 1 }).lean()) as { title?: string }[];
  const titles = rows.map((r) => r.title).filter((t): t is string => !!t);
  const aliases = new Map<string, string>();
  // 수동 별칭 사전(regulation_aliases) — 없으면 조용히 생략(선택 컬렉션). 관리자 추가분이 우선.
  try {
    const db = mongoose.connection?.db;
    if (db) {
      const rows = await db.collection("regulation_aliases").find({}).project({ alias: 1, title: 1, _id: 0 }).limit(2000).toArray();
      for (const r of rows as { alias?: string; title?: string }[]) {
        if (r.alias && r.title) aliases.set(normTitle(r.alias), r.title);
      }
    }
  } catch { /* 컬렉션 부재 등 → 별칭 없이 진행 */ }
  cache = { titles, aliases, at: Date.now() };
  return cache;
}

/** 테스트·스크립트용 캐시 무효화. */
export function _resetAliasCache(): void { cache = null; }

/** 명칭 → 정식 제목 해석. 유일하게 특정될 때만 title을 채운다(모호하면 candidates만). */
export async function resolveRegulationTitle(input: string): Promise<TitleResolve> {
  const { titles, aliases } = await loadTitleIndex();
  const n = normTitle(input);
  if (!n || n.length < 2) return { title: null, candidates: [], via: "none" };

  const byAlias = aliases.get(n);
  if (byAlias && titles.includes(byAlias)) return { title: byAlias, candidates: [byAlias], via: "alias" };

  const exact = titles.filter((t) => normTitle(t) === n);
  if (exact.length === 1) return { title: exact[0], candidates: exact, via: "exact" };
  if (exact.length > 1) return { title: null, candidates: exact, via: "exact" };

  // 포함일치: 입력⊂제목 또는 제목⊂입력 — 유일할 때만 채택("복무규정"은 임원복무·취업 규칙 등 다중이라 미채택)
  const substr = titles.filter((t) => { const tn = normTitle(t); return tn.includes(n) || n.includes(tn); });
  if (substr.length === 1) return { title: substr[0], candidates: substr, via: "substr" };
  if (substr.length > 1) return { title: null, candidates: substr.slice(0, 5), via: "substr" };

  // 바이그램: 최고점 ≥0.55 이고 2위와 0.12 이상 차이날 때만(유일 승자)
  const scored = titles.map((t) => ({ t, s: bigramSim(n, t) })).sort((a, b) => b.s - a.s);
  const [b1, b2] = [scored[0], scored[1]];
  if (b1 && b1.s >= 0.55 && (!b2 || b1.s - b2.s >= 0.12)) return { title: b1.t, candidates: [b1.t], via: "bigram" };
  return { title: null, candidates: scored.slice(0, 3).filter((x) => x.s >= 0.4).map((x) => x.t), via: "bigram" };
}

/** 전체 정식 제목 목록(캐시 경유) — 인용 게이트 등에서 재사용. */
export async function allRegulationTitles(): Promise<string[]> {
  return (await loadTitleIndex()).titles;
}

/**
 * 연성밴드 재시도용 결정적 질의 정규화(D) — LLM 없이:
 * ① 의미 토큰 재구성(조사 절단·불용어 제거·도메인 동의어 — retrievalSearchTokens)
 * ② 규정류 어미 토큰은 별칭 사전으로 정식 제목 치환(예: "복무규정"→"취업 규칙" 별칭 등록 시).
 * 원질의와 사실상 같으면 빈 문자열(재시도 불필요 신호).
 */
export async function normalizeQueryForRetry(q: string): Promise<string> {
  const tokens = retrievalSearchTokens(q);
  if (!tokens.length) return "";
  const out: string[] = [];
  for (const t of tokens) {
    if (/(규정|세칙|지침|요령|편람|매뉴얼|규칙)$/.test(t) && t.length >= 4) {
      try {
        const r = await resolveRegulationTitle(t);
        if (r.title) { out.push(r.title); continue; }
      } catch { /* 해석 실패 → 원토큰 유지 */ }
    }
    out.push(t);
  }
  const normalized = [...new Set(out)].join(" ");
  return normalized.replace(/\s+/g, "") === q.replace(/\s+/g, "") ? "" : normalized;
}
