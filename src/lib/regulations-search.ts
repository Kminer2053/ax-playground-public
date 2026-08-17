/**
 * 사규 하이브리드 검색 공용 파이프라인 — 지식검색(assistant)과 문서작성 사이드챗(ai/chat)이 공유.
 * 회수($text)→재랭킹(벡터·그래프정합성·제목특정성)→위계정렬→벡터 시드보강→그래프 확장→컨텍스트 조립.
 * assistant 라우트에서 검증(벤치 recall 77.2%, A/B fast 9:2)된 로직을 그대로 이동 — 여기 수정이 두 소비처에 동일 반영된다.
 */
import { retrieveRagRegulationsForQa, buildRegulationSnippetForLlm } from "@/lib/regulations-retrieve";
import { expandViaGraph, graphCoherence } from "@/lib/regulations-graph";
import { vectorSearchSeeds, type VecSeed, type VecArticleHint } from "@/lib/regulations-vector";
import { bm25SearchTitles } from "@/lib/regulations-bm25";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { normalizeQueryForRetry } from "@/lib/regulations-alias";
import {
  compactPhraseMatch,
  expandTermsForRag,
  queryTermsFromQuestion,
  ragRegulationTextBlob,
  semanticTermsForRag,
  termMatchRatio,
} from "@/lib/regulations-rag";

export type RegHit = {
  _id?: unknown;
  title?: string;
  year?: string;
  category?: string;
  docNumber?: string;
  content?: string;
  articles?: { name: string; fullText?: string; order?: number }[];
  score?: number | null;
  viaGraph?: { from: string; fromChunk: string; rel: string; reason?: string }; // 그래프 확장으로 추가된 관련 규정
  vecHit?: { bestChunk: string; score: number }; // 의미(임베딩)검색으로 추가된 문서
};

// ───────── 위계(분류) ─────────
const CAT_ORDER = ["규정", "세칙", "지침", "편람", "매뉴얼", "계약서"];
const catRank = (c?: string) => { const i = CAT_ORDER.indexOf(c ?? ""); return i < 0 ? 99 : i; };
const numOf = (n?: string) => { const m = (n ?? "").match(/\d+/); return m ? parseInt(m[0], 10) : 9999; };
/** 근거 문서를 위계(규정→…→계약서)→연번 순으로 정렬(상위 근거 먼저). */
export function orderByHierarchy(hits: RegHit[]): RegHit[] {
  return [...hits].sort((a, b) => catRank(a.category) - catRank(b.category) || numOf(a.docNumber) - numOf(b.docNumber));
}
export const HIERARCHY_GUIDE =
  "사규는 위계가 있습니다: 규정 > 세칙 > 지침 > 편람 > 매뉴얼 > 계약서. " +
  "답변은 상위 위계(규정)의 근거를 먼저 제시하고, 하위 위계로 갈수록 세부 절차를 상세화하는 순서로 체계적으로 작성하세요. " +
  "각 문서에 표시된 [역할]을 활용하세요 — 규범·원칙(규정·세칙·지침)은 '무엇을 어떻게 처리해야 하는지' 방향·판단기준으로, 절차·방법(편람·매뉴얼)은 구체적 실행 방법으로, 예시·근거(계약서)는 실제 사례·근거로 인용하세요. " +
  "각 근거에는 반드시 「규정명」(과 위계·연번, 예: 「자산관리규정」 규정 제16호)을 그대로 밝히세요. '문서1'·'문서2' 같은 번호 표기는 절대 쓰지 마세요.";

export function blobOf(hit: RegHit): string {
  return ragRegulationTextBlob({ title: hit.title, year: hit.year, content: hit.content });
}
export function keyOf(h: RegHit): string {
  return h._id != null ? String(h._id) : `${h.title ?? ""}::${h.year ?? ""}`;
}

export type RerankSignals = {
  bm25?: Map<string, number>; // 인앱 BM25(한국어 lexical 보완)
  vec?: Map<string, number>;  // 의미(벡터) 적합도 0~1 — topical 특정성 보정
  coh?: Map<string, number>;  // 그래프-정합성(후보군 내 연결도) — 도메인 군집 가산
};

export function rerankHits(q: string, textHits: RegHit[], signals: RerankSignals = {}): RegHit[] {
  const { bm25, vec, coh } = signals;
  const semantic = semanticTermsForRag(q);
  const termsForScore = semantic.length > 0 ? semantic : expandTermsForRag(q, queryTermsFromQuestion(q));
  const merged = new Map<string, { hit: RegHit; score: number }>();

  textHits.forEach((h, i) => {
    const k = keyOf(h);
    const entry = merged.get(k) ?? { hit: h, score: 0 };
    entry.score += Math.max(0, 42 - i * 2.8);
    merged.set(k, entry);
  });

  for (const entry of merged.values()) {
    const blob = blobOf(entry.hit);
    const tr = termMatchRatio(blob, termsForScore);
    const cp = compactPhraseMatch(q, blob);
    entry.score += tr * 28 + cp * 22;
    if (termsForScore.length > 0 && tr === 0 && cp === 0) {
      entry.score *= 0.35;
    }
    // 의미(벡터) 가중 — '전문점 계약'과 '광고 계약'을 topical하게 구분(어휘만 겹친 타 도메인 오답 강등).
    // 핵심 보정: 키워드($text)는 보편어(계약)에 끌려가지만 벡터는 주제 적합도로 판별.
    if (vec) entry.score += (vec.get(entry.hit.title ?? "") ?? 0) * 40;
    // 그래프-정합성 가중 — 같은 도메인 군집과 연결된 문서 가산(가산만, deg cap 3). 벡터가 못 미는 마지막 한 칸 보강.
    if (coh) entry.score += Math.min(coh.get(entry.hit.title ?? "") ?? 0, 3) * 6;
    // 제목 매칭 가중(특정성) — 질의어가 '제목'에 많이 들수록 도메인 적합. 「전문점 운영 계약서」(전문점+계약)가
    // generic 「계약업무 처리지침」(계약)보다 질의어를 더 많이 제목에 담아 상위로 → 보편어(계약) 편향을 직접 교정.
    const titleL = (entry.hit.title ?? "").toLowerCase();
    let titleHits = 0;
    for (const t of termsForScore) if (t.length >= 2 && titleL.includes(t.toLowerCase())) titleHits++;
    entry.score += titleHits * 9;
  }

  // BM25 신호(질의 어휘 정밀도 — $text 한국어 보완): 최댓값 정규화 후 가중 합산
  if (bm25 && bm25.size) {
    let maxB = 0;
    for (const v of bm25.values()) if (v > maxB) maxB = v;
    if (maxB > 0) {
      for (const entry of merged.values()) {
        const b = bm25.get(entry.hit.title ?? "") ?? 0;
        if (b > 0) entry.score += (b / maxB) * 30;
      }
    }
  }

  // 점수를 hit에 실어 반환(임계 캘리브레이션·텔레메트리용) — 기존엔 계산 후 폐기돼
  // 거절 게이트가 "검색 0건"뿐이라 사실상 미발동이던 원인(내부 감사 R4).
  for (const entry of merged.values()) entry.hit.score = Math.round(entry.score * 100) / 100;

  const ranked = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .map((x) => x.hit);

  const hasStrong = (h: RegHit) => {
    const b = blobOf(h);
    if (compactPhraseMatch(q, b) > 0) return true;
    if (semantic.length > 0) {
      return semantic.some((t) => t.length >= 2 && b.includes(t));
    }
    return termMatchRatio(b, termsForScore) >= 0.34;
  };

  const withStrongKw = ranked.filter(hasStrong);
  if (withStrongKw.length >= 3) return withStrongKw;
  return ranked;
}

// ───────── 검색 신호(거절 임계·텔레메트리) ─────────
export type SearchSignals = {
  top1: number | null;   // 재랭크 1위 종합점수(상대값 — 분포 기반 임계용)
  top2: number | null;
  gap: number | null;    // 특정성: 1·2위 격차
  vecTop: number | null; // 벡터 원시 코사인 최고값(절대 신호 — bge-m3)
  strongHits: number;    // 강한 키워드 매칭(구문 or 의미어) 문서 수
  textHits: number;      // $text 회수 건수
};

/** 재랭크 결과·벡터 원시점수에서 거절 게이트/텔레메트리용 신호 요약을 계산. */
export function computeSearchSignals(
  q: string,
  ranked: RegHit[],
  o: { vecRawTop?: number | null; textHitCount?: number } = {},
): SearchSignals {
  const semantic = semanticTermsForRag(q);
  const terms = semantic.length ? semantic : expandTermsForRag(q, queryTermsFromQuestion(q));
  let strong = 0;
  for (const h of ranked) {
    const b = blobOf(h);
    if (compactPhraseMatch(q, b) > 0 || (semantic.length ? semantic.some((t) => t.length >= 2 && b.includes(t)) : termMatchRatio(b, terms) >= 0.34)) strong++;
  }
  const s1 = ranked[0]?.score ?? null;
  const s2 = ranked[1]?.score ?? null;
  return {
    top1: s1, top2: s2,
    gap: s1 != null && s2 != null ? Math.round((s1 - s2) * 100) / 100 : null,
    vecTop: o.vecRawTop ?? null,
    strongHits: strong,
    textHits: o.textHitCount ?? ranked.length,
  };
}

/** 지식 성격별 역할(규범=원칙·방향 / 절차=구체 방법 / 예시=근거·사례). 위계: 규정>세칙>지침>편람>매뉴얼>계약서 */
export function roleOf(category?: string): string {
  const c = category ?? "";
  if (/계약/.test(c)) return "예시·근거";
  if (/편람|매뉴얼/.test(c)) return "절차·방법";
  if (/규정|세칙|지침|규칙|예규|요령|기준|정관/.test(c)) return "규범·원칙";
  return "";
}

/** 근거 문서 컨텍스트 — 위계·연번·역할 라벨 포함(모델이 상위→하위 구조와 문서 성격을 따르도록).
 *  vecArts: 문서별 임베딩 상위 조문(제목→힌트) — 조문 선택이 키워드에만 의존하지 않게 의미신호 배선. */
export function buildContextText(question: string, hits: RegHit[], snippetLen: number, deep: boolean, extraRelations: string[] = [], vecArts?: Map<string, VecArticleHint[]>): string {
  const relations: string[] = [];
  const blocks = hits.map((d) => {
    const role = roleOf(d.category);
    const roleTag = role ? ` [역할: ${role}]` : "";
    const hints = vecArts?.get(d.title ?? "");
    if (d.viaGraph) {
      // 그래프 확장 문서: 어느 시드 조문에서 어떤 관계로 연결됐는지 명시 + 짧은 스니펫(보조 근거)
      relations.push(d.viaGraph.reason?.trim()
        ? `「${d.viaGraph.from}」 → 「${d.title ?? "(제목없음)"}」 (${d.viaGraph.rel}): ${d.viaGraph.reason.trim()}`
        : `「${d.viaGraph.from}」 ─${d.viaGraph.rel}→ 「${d.title ?? "(제목없음)"}」`);
      const body = buildRegulationSnippetForLlm(d.content ?? "", question, Math.min(snippetLen, 700), d.articles, hints);
      const label = `「${d.title ?? "(제목없음)"}」${roleTag} (관련 규정 — 「${d.viaGraph.from}」의 ${d.viaGraph.rel})`;
      return `${label}\n${body.trim() || "(본문 없음)"}`;
    }
    if (d.vecHit) {
      // 의미검색으로 추가된 문서(키워드 불일치) — 보조 근거로 짧게
      const body = buildRegulationSnippetForLlm(d.content ?? "", question, Math.min(snippetLen, 900), d.articles, hints);
      const label = `「${d.title ?? "(제목없음)"}」${roleTag} (의미검색 관련)`;
      return `${label}\n${body.trim() || "(본문 없음)"}`;
    }
    const meta = [d.category, d.docNumber, d.year].filter(Boolean).join(", ");
    const label = `「${d.title ?? "(제목없음)"}」${meta ? ` (${meta})` : ""}${roleTag}`; // 규정명 우선(문서N 미사용)
    const body = buildRegulationSnippetForLlm(d.content ?? "", question, snippetLen, d.articles, hints);
    return `${label}\n${body.trim() || "(본문 없음)"}`;
  });
  let out = blocks.join("\n\n---\n\n");
  const allRel = [...new Set([...relations, ...extraRelations])]; // 교차규정(viaGraph) + 문서내·법령(seedRelations)
  if (deep && allRel.length) out += `\n\n【규정 간 관계(그래프 분석)】\n${allRel.join("\n")}`; // 관계 합성은 심층 전용(간편은 직답 유지)
  return out;
}

// ───────── 조합 파이프라인(빠른검색 동급) — 문서작성 사이드챗 등 다른 소비처용 ─────────
export type FastSearchResult = {
  allHits: RegHit[];
  contextText: string;
  vecArts?: Map<string, VecArticleHint[]>;
  meta: {
    textHits: number; vecAdds: number; graphAdds: number;
    vecTop: number | null; // 전역 최고 코사인(원시) — 소비처의 근거 주입 게이트용(예: 사이드챗)
    softRetry?: { attempted: boolean; adopted: boolean; before: number | null; after: number | null };
  };
};

/**
 * 지식검색 '빠른검색'과 동일 품질의 원스톱 검색+컨텍스트 조립.
 * 벡터/그래프는 설정(ragVectorEnabled·ragGraphEnabled)과 env 하드킬을 따르고, 실패 시 각자 조용히 생략.
 */
export async function fastSearchRegulations(
  question: string,
  o?: { maxDocs?: number; snippetLen?: number; vecAddsMax?: number; graphMax?: number },
): Promise<FastSearchResult> {
  const maxDocs = o?.maxDocs ?? 5;
  const snippetLen = o?.snippetLen ?? 900;
  const cfg = await getPlaygroundConfig();
  const vectorOn = cfg.ragVectorEnabled && process.env.VECTOR_SEARCH !== "0";
  const graphOn = cfg.ragGraphEnabled && process.env.GRAPH_EXPANSION !== "0";
  const bm25On = process.env.BM25_SEARCH === "1";

  let textHits: RegHit[] = [];
  try { textHits = (await retrieveRagRegulationsForQa(question, maxDocs + 4)) as RegHit[]; } catch { textHits = []; }

  let bm25Map: Map<string, number> | undefined;
  if (bm25On) {
    try {
      const bm = await bm25SearchTitles(question, maxDocs + 4);
      bm25Map = new Map(bm.map((x) => [x.title, x.score]));
    } catch { /* skip */ }
  }

  let vsAll: VecSeed[] = [];
  let vecScore: Map<string, number> | undefined;
  if (vectorOn) {
    try {
      vsAll = await vectorSearchSeeds(question, maxDocs * 4 + 8, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
      let maxV = 0;
      for (const v of vsAll) if (v.score > maxV) maxV = v.score;
      if (maxV > 0) vecScore = new Map(vsAll.map((v) => [v.title, v.score / maxV]));
    } catch { /* 임베딩 서버 미가동 → 벡터 신호 없이 진행 */ }
  }

  let cohMap: Map<string, number> | undefined;
  if (graphOn) {
    try { cohMap = await graphCoherence(textHits.map((h) => h.title).filter((t): t is string => !!t)); }
    catch { /* skip */ }
  }

  let ranked = rerankHits(question, textHits, { bm25: bm25Map, vec: vecScore, coh: cohMap }).slice(0, maxDocs);

  // ── 연성밴드 결정적 재회수(D 공용화) — 지식검색 라우트와 동일 원칙을 공유 파이프라인에도 적용:
  //    근거 신호가 약할 때(전역 최고 코사인 < 0.60) 별칭 치환·의미토큰 재구성 질의(비LLM)로 1회 재시도,
  //    vecTop이 +0.02 이상 오를 때만 채택(병합 상한 2 — 드리프트·오염 방지). 사이드챗 등 소비처가 함께 이득.
  let softRetry: FastSearchResult["meta"]["softRetry"];
  {
    let vecTop: number | null = null;
    for (const v of vsAll) if (vecTop == null || v.score > vecTop) vecTop = v.score;
    if (vectorOn && vecTop != null && vecTop < 0.60) {
      try {
        const normalizedQ = await normalizeQueryForRetry(question);
        if (normalizedQ) {
          softRetry = { attempted: true, adopted: false, before: vecTop, after: null };
          const t2 = await vectorSearchSeeds(normalizedQ, maxDocs * 4 + 8, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
          let after: number | null = null;
          for (const v of t2) if (after == null || v.score > after) after = v.score;
          softRetry.after = after;
          if (after != null && after > vecTop + 0.02) {
            const fresh = ((await retrieveRagRegulationsForQa(normalizedQ, maxDocs)) as RegHit[]);
            const have = new Set(textHits.map(keyOf));
            const add = fresh.filter((h) => !have.has(keyOf(h))).slice(0, 2);
            if (add.length) textHits = [...textHits, ...add];
            vsAll.push(...t2);
            const vm = new Map<string, number>();
            let maxV = 0;
            for (const v of vsAll) { if (v.score > (vm.get(v.title) ?? 0)) vm.set(v.title, v.score); if (v.score > maxV) maxV = v.score; }
            if (maxV > 0) vecScore = new Map([...vm].map(([tt, ss]) => [tt, ss / maxV]));
            ranked = rerankHits(question, textHits, { bm25: bm25Map, vec: vecScore, coh: cohMap }).slice(0, maxDocs);
            softRetry.adopted = true;
          }
        }
      } catch { /* 재시도 실패 → 1차 결과 유지 */ }
    }
  }
  const hits = orderByHierarchy(ranked);

  const citeTerms = (() => {
    const s = semanticTermsForRag(question);
    return s.length ? s : expandTermsForRag(question, queryTermsFromQuestion(question));
  })();

  let vecAdds: RegHit[] = [];
  if (vectorOn && vsAll.length) {
    const have = new Set(hits.map((h) => h.title));
    vecAdds = vsAll
      .filter((v) => !have.has(v.title))
      .slice(0, o?.vecAddsMax ?? 3)
      .map((v) => ({ ...(v.doc as RegHit), vecHit: { bestChunk: v.bestChunk, score: v.score } }));
  }

  let graphAdds: RegHit[] = [];
  if (graphOn && (ranked.length || vecAdds.length)) {
    try {
      const exp = await expandViaGraph([...ranked, ...vecAdds], citeTerms, o?.graphMax ?? 2);
      const have = new Set([...hits, ...vecAdds].map((h) => h.title));
      graphAdds = exp
        .filter((e) => !have.has(e.title))
        .map((e) => ({ ...(e.doc as RegHit), viaGraph: { from: e.from, fromChunk: e.fromChunk, rel: e.rel, reason: e.reason } }));
    } catch { /* skip */ }
  }

  const allHits = [...hits, ...vecAdds, ...graphAdds];
  const vecArts = vsAll.length ? new Map(vsAll.map((v) => [v.title, v.topArticles])) : undefined;
  const contextText = allHits.length ? buildContextText(question, allHits, snippetLen, false, [], vecArts) : "";
  let vecTopFinal: number | null = null;
  for (const v of vsAll) if (vecTopFinal == null || v.score > vecTopFinal) vecTopFinal = v.score;
  return { allHits, contextText, vecArts, meta: { textHits: textHits.length, vecAdds: vecAdds.length, graphAdds: graphAdds.length, vecTop: vecTopFinal, softRetry } };
}
