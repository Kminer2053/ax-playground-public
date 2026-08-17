import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { env } from "@/lib/env";
import { recordUsage } from "@/lib/usage";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { rerankHits, orderByHierarchy, buildContextText, keyOf, HIERARCHY_GUIDE, computeSearchSignals, type RegHit, type SearchSignals } from "@/lib/regulations-search";
import { buildExtractiveOutcome, fetchSeedDocsByTitles, resolveCitedTitles } from "@/lib/regulations-lookup";
import { normalizeQueryForRetry } from "@/lib/regulations-alias";
import { verifyCitations, buildCorrection, buildWarnFooter, type CiteCheck } from "@/lib/regulations-cite-gate";
import { KnowledgeQueryLogModel } from "@/models/KnowledgeQueryLog";
import { expandViaGraph, seedRelations, graphCoherence } from "@/lib/regulations-graph";
import { vectorSearchSeeds, type VecSeed } from "@/lib/regulations-vector";
import { bm25SearchTitles } from "@/lib/regulations-bm25";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { guardedChat, guardedStreamChat, buildGuardContext, isGuardBlockedError } from "@/lib/guardrails";
import {
  expandTermsForRag,
  pickArticlesForContext,
  queryTermsFromQuestion,
  semanticTermsForRag,
} from "@/lib/regulations-rag";

// RegHit·재랭킹·위계정렬·컨텍스트 조립은 @/lib/regulations-search 로 이동(문서작성 사이드챗과 공유).

// ───────── 심층검색: 의도 파악·키워드 확장 ─────────
const INTENT_PROMPT = (q: string) =>
  "다음 사내 사규 질문의 핵심 의도를 한 문장으로 요약하고, 검색에 쓸 핵심 키워드(동의어·관련 제도/법령명 포함)를 쉼표로 8개 이내 나열하세요. " +
  "다른 설명 없이 아래 형식 두 줄만 출력:\n의도: <한 문장>\n키워드: <쉼표로 구분>\n\n질문: " + q;

function parseIntent(text: string): { intent: string; keywords: string[] } {
  const intent = (text.match(/의도\s*[:：]\s*(.+)/)?.[1] ?? "").trim().slice(0, 200);
  const kwLine = (text.match(/키워드\s*[:：]\s*(.+)/)?.[1] ?? "");
  const keywords = kwLine.split(/[,，、]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 24).slice(0, 8);
  return { intent, keywords };
}

const DEEP_SYSTEM =
  "당신은 사내 사규 안내 보조입니다. 반드시 아래【근거 문서】에 실제로 나온 문구만 근거로 삼아 답하고, 없는 내용은 단정하지 말고 \"제공된 자료에 없음\"으로 표기하세요. " +
  HIERARCHY_GUIDE + " " +
  "답변은 GitHub Flavored Markdown으로 정확히 다음 4개 섹션 제목만 사용하세요(괄호·부연 금지): `## 요약` / `## 근거` / `## 적용 순서·유의` / `## 한계·추가 확인`. " +
  "`## 근거`는 각 규정을 `- ` 불릿으로 **별도 줄**에 작성하세요(항목마다 줄바꿈). 각 항목은 「규정명」(위계·연번)에 이어 **핵심 1~2문장만** 인용하고, 조문의 여러 호(號)를 통째로 이어 붙이지 마세요(많으면 핵심 호만 인용하거나 요약). 위계 상위→하위 순. '문서1' 같은 번호 표기는 쓰지 마세요. " +
  "`## 한계·추가 확인`에는 최종 판단은 담당 부서 확인이 필요하다는 문장을 한 줄 넣으세요. " +
  "【규정 간 관계】가 제공되면, 어떤 규정이 어떤 규정에 근거·준용·위임하는지 그 논리적 연결을 `## 근거`에서 명시해 설명하세요(예: 「A」는 「B」에 근거함).";

const FAST_MAX = 5;
const DEEP_MAX = 8;

/** 질의 텔레메트리 기록(fire-and-forget) — 임계 캘리브레이션·자동피드백 루프의 원천(감사 R4 해소). */
function logQuery(fields: {
  q: string; mode: string; path: "llm" | "extractive" | "refused" | "empty";
  signals?: SearchSignals | null; citedTitles?: string[]; counts?: { text: number; vec: number; graph: number };
  gate?: Partial<CiteCheck> & { retried?: boolean; refetched?: string[] }; stages?: { s: string; ms: number; n?: number }[]; latencyMs: number;
  retry?: { attempted: boolean; adopted: boolean; normalizedQ: string; vecTopBefore: number | null; vecTopAfter: number | null };
}): void {
  const day = new Date().toISOString().slice(0, 10);
  void KnowledgeQueryLogModel.create({
    q: fields.q.slice(0, 500), mode: fields.mode, path: fields.path,
    signals: fields.signals ?? undefined, citedTitles: (fields.citedTitles ?? []).slice(0, 20),
    counts: fields.counts, gate: fields.gate ? {
      checked: !!fields.gate.checked, unknownTitles: fields.gate.unknownTitles ?? [],
      wrongArticles: fields.gate.wrongArticles ?? [], retried: !!fields.gate.retried,
      refetched: fields.gate.refetched ?? [],
    } : undefined,
    stages: fields.stages ?? [], retry: fields.retry ?? undefined, latencyMs: fields.latencyMs, day,
  }).catch(() => { /* 텔레메트리 실패는 본 응답에 영향 없음 */ });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { q?: string; question?: string; stream?: boolean; mode?: string; diag?: boolean }
    | null;
  const wantStream = body?.stream === true;
  const deep = body?.mode === "deep";
  const t0 = Date.now();
  const stages: { s: string; ms: number; n?: number }[] = [];
  const mark = <T,>(s: string, fn: () => T | Promise<T>, n?: (r: T) => number): Promise<T> => {
    const st = Date.now();
    return Promise.resolve(fn()).then((r) => { stages.push({ s, ms: Date.now() - st, ...(n ? { n: n(r) } : {}) }); return r; });
  };
  const question =
    (typeof body?.q === "string" ? body.q.trim() : "") ||
    (typeof body?.question === "string" ? body.question.trim() : "");
  if (!question) {
    return NextResponse.json({ error: "질문(q 또는 question)을 입력해 주세요." }, { status: 400 });
  }

  await connectDb();
  const ctx = await buildGuardContext(req, "knowledge");
  // 사용 계측은 종결점별 액션(fast/deep/extractive/refused/empty/blocked)으로 기록 — 관리자 '실행 세부' 표출용.

  // ── 추출형 직행: "○○규정 제N조" 조회형은 LLM 없이 조문 원문 반환(환각 0·즉시 응답).
  // 판정 애매(다중 후보·해석형 어미)면 null → 기존 검색·LLM 경로로 자연 폴백.
  // 다중 후보였다면 그 제목들을 버리지 않고 검색 시드로 넘긴다(C — 사용자가 지목한 규정이 회수에서 밀리는 것 방지).
  let extSeedTitles: string[] = [];
  try {
    const extOut = await mark("extractive", () => buildExtractiveOutcome(question));
    extSeedTitles = extOut.seedTitles;
    const ext = extOut.result;
    if (ext) {
      recordUsage("knowledge", "extractive");
      logQuery({ q: question, mode: deep ? "deep" : "fast", path: "extractive", citedTitles: ext.references.map((r) => r.title ?? ""), stages, latencyMs: Date.now() - t0 });
      if (wantStream) {
        // 스트림 요청도 동일 이벤트 시퀀스로 즉시 완결(프런트 호환)
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          start(c) {
            const send = (o: Record<string, unknown>) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
            send({ type: "meta", references: ext.references, citations: ext.citations, intent: "", mode: deep ? "deep" : "fast", extractive: true });
            send({ type: "delta", text: ext.answer });
            send({ type: "done" });
            c.close();
          },
        });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
      }
      return NextResponse.json({ ok: true, answer: ext.answer, references: ext.references, citations: ext.citations, intent: "", mode: deep ? "deep" : "fast", extractive: true });
    }
  } catch { /* 추출형 실패 → 기존 경로로 폴백(안전측) */ }

  const cfg = await getPlaygroundConfig(); // 런타임 설정(임베딩/그래프 on·off, 임베딩 모델)
  const vectorOn = cfg.ragVectorEnabled && process.env.VECTOR_SEARCH !== "0"; // env="0"은 하드 킬
  const graphOn = cfg.ragGraphEnabled && process.env.GRAPH_EXPANSION !== "0";
  const bm25On = process.env.BM25_SEARCH === "1"; // 인앱 BM25 lexical(기본 off — 103문서 코퍼스선 효과 중립, 코퍼스 커지면 env="1"로 켜서 재평가)

  const maxDocs = deep ? DEEP_MAX : FAST_MAX;
  const snippetLen = deep ? 2000 : 900;

  // ── 심층: ① 의도 파악·키워드 확장(LLM) → 넓은 회수 ──
  let intent = "";
  let searchQuery = question;
  if (deep) {
    try {
      const out = await guardedChat({
        messages: [{ role: "user", content: INTENT_PROMPT(question) }],
        ctx, maxTokens: 512, temperature: 0.1, guardInput: question,
      });
      const parsed = parseIntent(out);
      intent = parsed.intent;
      if (parsed.keywords.length) searchQuery = `${question} ${parsed.keywords.join(" ")}`;
    } catch { /* 의도파악 실패 시 원질문으로 진행 */ }
  }

  // ── 회수 → 재랭킹 → 위계 정렬 ──
  // 확장(gemma 키워드)은 recall용이지 ranking용이 아니다. 심층도 '원질문'으로 1차 회수해 랭킹 기준을 잡고,
  // 확장질의 회수분은 '뒤에 덧붙여' recall만 보강한다(낮은 position). 그래야 확장이 generic 보편어로 드리프트해도
  // 원질문 의도(예: 전문점)가 순위를 지배하고, 어휘만 겹친 타 도메인(광고)이 상위를 차지하지 못한다.
  let textHits: RegHit[] = [];
  try {
    await mark("text", async () => {
      textHits = (await retrieveRagRegulationsForQa(question, maxDocs + (deep ? 6 : 4))) as RegHit[];
      if (deep && searchQuery !== question) {
        const have = new Set(textHits.map(keyOf));
        const extra = (await retrieveRagRegulationsForQa(searchQuery, maxDocs)) as RegHit[];
        for (const h of extra) { const k = keyOf(h); if (!have.has(k)) { textHits.push(h); have.add(k); } }
      }
    });
    if (stages.length) stages[stages.length - 1].n = textHits.length;
  } catch {
    textHits = [];
  }
  // 추출형 다중 후보 시드(C): 사용자가 규정명으로 지목했으나 모호했던 문서를 선두에 배치 —
  // 회수 순위 기본점(위치 감쇠)이 이들을 우대하고, 재랭킹 신호가 최종 판단한다.
  if (extSeedTitles.length) {
    try {
      const seedDocs = (await fetchSeedDocsByTitles(extSeedTitles)) as RegHit[];
      if (seedDocs.length) {
        const seedKeys = new Set(seedDocs.map(keyOf));
        textHits = [...seedDocs, ...textHits.filter((h) => !seedKeys.has(keyOf(h)))];
        stages.push({ s: "ext-seed", ms: 0, n: seedDocs.length });
      }
    } catch { /* 시드 로드 실패 → 기존 회수만으로 진행 */ }
  }
  // BM25(인앱 한국어 lexical) — 재랭킹 신호로만 사용($text 한국어 약점 보완).
  // 후보 보강(상위 문서 끼워넣기)은 어휘만 겹치는 무관 규정을 주입해 정답 인용을 떨어뜨려 제외.
  let bm25Map: Map<string, number> | undefined;
  if (bm25On) {
    try {
      const bm = await bm25SearchTitles(searchQuery, maxDocs + (deep ? 6 : 4));
      bm25Map = new Map(bm.map((x) => [x.title, x.score]));
    } catch { /* BM25 실패 시 기존 회수로 진행 */ }
  }
  // ── 의미(벡터) 회수 — 재랭킹 신호 + 시드 보강에 함께 사용(한 번만 호출) ──
  // bge-m3 코사인은 '전문점 계약'과 '광고 계약'을 topical하게 구분 → 재랭킹에서 어휘편향(보편어)을 보정.
  // 중요: 벡터는 키워드 확장이 불필요(임베딩이 동의어 처리)하고, 확장질의를 쓰면 심층에서 의도 드리프트가
  // 벡터에까지 번진다. 그래서 벡터는 항상 '원질문'으로 — 사용자의 실제 주제의도에 맞춰 재랭킹·시드한다.
  let vsAll: VecSeed[] = [];
  let vecScore: Map<string, number> | undefined;
  if (vectorOn) {
    try {
      vsAll = await vectorSearchSeeds(question, maxDocs * 4 + 8, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
      let maxV = 0;
      for (const v of vsAll) if (v.score > maxV) maxV = v.score;
      if (maxV > 0) vecScore = new Map(vsAll.map((v) => [v.title, v.score / maxV])); // 최댓값 정규화 0~1
    } catch { /* 임베딩 서버 미가동 등 → 벡터 신호 없이 진행 */ }
  }

  // ── 그래프-정합성 신호 — 후보들이 같은 도메인 군집으로 그래프 연결됐는지(재랭킹 가산) ──
  let cohMap: Map<string, number> | undefined;
  if (graphOn) {
    try { cohMap = await graphCoherence(textHits.map((h) => h.title).filter((t): t is string => !!t)); }
    catch { /* 그래프 미적재 등 → 무시 */ }
  }

  // 랭킹·신호 계산 — 연성밴드 재회수(D) 채택 시 재계산되므로 닫힌 함수로 묶는다(현재 스코프의 최신 상태 사용).
  const computeRanking = () => {
    const r = rerankHits(question, textHits, { bm25: bm25Map, vec: vecScore, coh: cohMap }).slice(0, maxDocs); // 질의 관계순(그래프 확장 가중용)
    let vecRawTop: number | null = null;
    for (const v of vsAll) if (vecRawTop == null || v.score > vecRawTop) vecRawTop = v.score;
    return { ranked: r, hits: orderByHierarchy(r), signals: computeSearchSignals(question, r, { vecRawTop, textHitCount: textHits.length }) };
  };
  let { ranked, hits, signals } = computeRanking();

  // ── 3분기 게이트(벤치 120문항 분포 캘리브레이션, /tmp/score-dist.json 2026-07-17):
  //  · 경성 거절: vecTop<0.53 — 오거절 0/92, 범위밖 46%(명백 8/10) 차단. gemma 미호출.
  //  · 연성(주의) 밴드: 0.53≤vecTop<0.60 또는 strong=0 — 정상·범위밖 분포가 겹치는 구간이라
  //    거절하지 않되(과잉거절=신뢰훼손) 프롬프트 주의 지시 + 응답 lowConfidence 플래그로 표시.
  const HARD_VEC = 0.53, SOFT_VEC = 0.60;
  const isLowConfidence = (s: SearchSignals) =>
    !(s.vecTop != null && s.vecTop < HARD_VEC) && ((s.vecTop != null && s.vecTop < SOFT_VEC) || s.strongHits === 0);
  const hardRefuse = signals.vecTop != null && signals.vecTop < HARD_VEC;
  let lowConfidence = isLowConfidence(signals);
  if (hardRefuse) {
    const near = hits.slice(0, 3).map((h) => `「${h.title ?? ""}」`).filter((s) => s !== "「」").join(", ");
    const refuseAnswer =
      `질문과 직접 관련된 사규 근거를 찾지 못했습니다.\n\n` +
      `- 사규 범위 밖 주제이거나, 사규에 규정이 없는 내용일 수 있습니다.\n` +
      (near ? `- 가장 가까운 문서: ${near} — 사규 관련 질문이라면 용어를 바꿔 다시 검색해 보세요.\n` : "") +
      `- 제도·복지 등 개인 사안은 담당 부서에 문의해 주세요.`;
    recordUsage("knowledge", "refused");
    logQuery({ q: question, mode: deep ? "deep" : "fast", path: "refused", signals, counts: { text: textHits.length, vec: 0, graph: 0 }, stages, latencyMs: Date.now() - t0 });
    if (wantStream) {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(c) {
          const send = (o: Record<string, unknown>) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
          send({ type: "meta", references: [], citations: [], intent, mode: deep ? "deep" : "fast", refused: true });
          send({ type: "delta", text: refuseAnswer });
          send({ type: "done" });
          c.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
    }
    return NextResponse.json({ ok: true, answer: refuseAnswer, references: [], citations: [], intent, mode: deep ? "deep" : "fast", refused: true });
  }

  // ── 연성밴드 결정적 재회수(D): 별칭 치환·의미 토큰 재구성 질의(비LLM)로 1회 재시도, vecTop이 오를 때만 채택.
  //    경성거절 구간엔 적용하지 않는다(코퍼스 어휘 피벗의 false-accept 침식 방지 — 검증 렌즈 지적 반영).
  let retryMeta: { attempted: boolean; adopted: boolean; normalizedQ: string; vecTopBefore: number | null; vecTopAfter: number | null } | undefined;
  if (lowConfidence) {
    try {
      const normalizedQ = await normalizeQueryForRetry(question);
      if (normalizedQ) {
        retryMeta = { attempted: true, adopted: false, normalizedQ, vecTopBefore: signals.vecTop, vecTopAfter: null };
        const t2 = vectorOn
          ? await vectorSearchSeeds(normalizedQ, maxDocs * 4 + 8, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl })
          : [];
        let after: number | null = null;
        for (const v of t2) if (after == null || v.score > after) after = v.score;
        retryMeta.vecTopAfter = after;
        // 채택 조건: 원질의 대비 명확한 개선(+0.02)일 때만 — 재표현 드리프트를 코드에서 흡수
        if (after != null && (signals.vecTop == null || after > signals.vecTop + 0.02)) {
          const fresh = ((await retrieveRagRegulationsForQa(normalizedQ, maxDocs)) as RegHit[]);
          const have = new Set(textHits.map(keyOf));
          const add = fresh.filter((h) => !have.has(keyOf(h))).slice(0, 2); // 병합 상한 2 — 무관 문서 오염 방지
          if (add.length) textHits = [...textHits, ...add];
          vsAll.push(...t2);
          // 벡터 재랭킹 신호 재정규화(제목별 최대 코사인)
          const vm = new Map<string, number>();
          let maxV = 0;
          for (const v of vsAll) { if (v.score > (vm.get(v.title) ?? 0)) vm.set(v.title, v.score); if (v.score > maxV) maxV = v.score; }
          if (maxV > 0) vecScore = new Map([...vm].map(([tt, ss]) => [tt, ss / maxV]));
          ({ ranked, hits, signals } = computeRanking());
          lowConfidence = isLowConfidence(signals);
          retryMeta.adopted = true;
          stages.push({ s: "soft-retry", ms: 0, n: add.length });
        }
      }
    } catch { /* 재회수 실패 → 1차 결과 유지(안전측) */ }
  }

  const citeTerms = (() => {
    const s = semanticTermsForRag(searchQuery);
    return s.length ? s : expandTermsForRag(searchQuery, queryTermsFromQuestion(searchQuery));
  })();

  // ── 의미 시드 보강: 벡터 상위 중 키워드 시드에 없는 것만 추가(위 vsAll 재사용) ──
  let vecAdds: RegHit[] = [];
  if (vectorOn && vsAll.length) {
    const have = new Set(hits.map((h) => h.title));
    vecAdds = vsAll
      .filter((v) => !have.has(v.title))
      .slice(0, deep ? 4 : 3)
      .map((v) => ({ ...(v.doc as RegHit), vecHit: { bestChunk: v.bestChunk, score: v.score } }));
  }

  // ── 그래프 확장: (키워드+벡터) 시드의 '질의 관련 청크' 참조(chunk→doc)로 관련 규정 보강(GraphRAG) ──
  const seedForGraph = [...ranked, ...vecAdds];
  let graphAdds: RegHit[] = [];
  if (graphOn && seedForGraph.length) {
    try {
      const exp = await expandViaGraph(seedForGraph, citeTerms, deep ? 3 : 2);
      const have = new Set([...hits, ...vecAdds].map((h) => h.title));
      graphAdds = exp
        .filter((e) => !have.has(e.title))
        .map((e) => ({ ...(e.doc as RegHit), viaGraph: { from: e.from, fromChunk: e.fromChunk, rel: e.rel, reason: e.reason } }));
    } catch {
      /* 그래프 확장 실패 시 무시(기존 회수만으로 진행) */
    }
  }
  const allHits = [...hits, ...vecAdds, ...graphAdds];

  // 문서별 임베딩 상위 조문(힌트) — 컨텍스트/인용의 조문 선택에 의미신호 배선(제목→힌트)
  const vecArts = vsAll.length ? new Map(vsAll.map((v) => [v.title, v.topArticles])) : undefined;

  // 심층: 시드 문서의 문서내 조문간·외부법령 관계도 관계배선에 보강(새 문서 없이 관계 진술만)
  const extraRelations = deep && graphOn ? await seedRelations(seedForGraph, citeTerms, 8) : [];
  let contextText = buildContextText(question, allHits, snippetLen, deep, extraRelations, vecArts);

  // ── 컨텍스트 예산 가드: 서버(Ollama)는 num_ctx 초과 시 프롬프트 '앞'(시스템 지시)부터 무음 절단한다.
  //    앱이 먼저 검사·절단하고 소리 낸다. allHits 꼬리 제거 = 그래프 확장→벡터 보강→하위 위계 순(주근거 마지막 보루).
  //    allHits 자체를 줄여야 citations·인용게이트 근거셋이 모델이 실제 본 컨텍스트와 일치한다.
  {
    const outTokens = deep ? 4096 : 3072; // 아래 maxTokens와 동일 값
    const budgetChars = Math.max(4_000, Math.floor((env.LLM_NUM_CTX - outTokens - 512) * 1.4)); // 한국어 ≈1.4자/토큰(보수)
    const overheadChars = (deep ? DEEP_SYSTEM.length + 200 : HIERARCHY_GUIDE.length + 200) + question.length + 120;
    let droppedHits = 0, trimmedTailChars = 0;
    while (allHits.length > 1 && contextText.length + overheadChars > budgetChars) {
      allHits.pop();
      droppedHits++;
      contextText = buildContextText(question, allHits, snippetLen, deep, extraRelations, vecArts);
    }
    if (contextText.length + overheadChars > budgetChars) {
      const keep = Math.max(500, budgetChars - overheadChars);
      trimmedTailChars = contextText.length - keep;
      contextText = `${contextText.slice(0, keep)}\n…[컨텍스트 예산 초과 — ${trimmedTailChars.toLocaleString()}자 절단]`;
    }
    if (droppedHits > 0 || trimmedTailChars > 0) {
      stages.push({ s: "budget-trim", ms: 0, n: droppedHits }); // 텔레메트리: stages로 흘러가 KnowledgeQueryLog에 남는다
      console.warn(
        `[knowledge] 컨텍스트 예산 초과 — LLM_NUM_CTX=${env.LLM_NUM_CTX} 예산 ${budgetChars.toLocaleString()}자(모드 ${deep ? "심층" : "빠른"}): ` +
        `후순위 문서 ${droppedHits}건 제외, 꼬리 ${trimmedTailChars.toLocaleString()}자 절단 → 최종 ${contextText.length.toLocaleString()}자`,
      );
    }
  }
  if (!contextText.trim()) {
    recordUsage("knowledge", "empty");
    logQuery({ q: question, mode: deep ? "deep" : "fast", path: "empty", signals, counts: { text: textHits.length, vec: vecAdds.length, graph: graphAdds.length }, stages, latencyMs: Date.now() - t0 });
    return NextResponse.json({
      ok: true,
      answer: "검색된 사규 조문이 없어 답변할 근거가 없습니다. 키워드를 바꾸거나 법무 담당자에게 문의해 주세요.",
      references: [], citations: [], intent,
    });
  }

  const citations = allHits.map((d) => ({
    id: d._id != null ? String(d._id) : "",
    title: d.title,
    category: "regulation" as const,
    year: d.year ?? "",
    articles: pickArticlesForContext(d.articles, question, citeTerms, 3, 0, vecArts?.get(d.title ?? "")).map((a) => a.name).filter((n): n is string => !!n),
    ...(d.viaGraph ? { viaGraph: true } : {}),
    ...(d.vecHit ? { vecHit: true } : {}),
  }));
  const references = allHits.map((h) => ({
    title: h.title,
    revisionInfo: h.year ?? "",
    id: h._id != null ? String(h._id) : undefined,
    category: "regulation" as const,
    ...(h.viaGraph ? { viaGraph: true, relatedFrom: h.viaGraph.from } : {}),
    ...(h.vecHit ? { vecHit: true } : {}),
  }));

  function sseResponse(gen: AsyncGenerator<string, void, unknown>) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        let full = "";
        try {
          send({ type: "meta", references, citations, intent, mode: deep ? "deep" : "fast", ...(lowConfidence ? { lowConfidence: true } : {}) });
          for await (const text of gen) { full += text; send({ type: "delta", text }); }
          // 스트림은 재생성이 불가하므로 게이트는 검증·표시만 — 위반 시 경고 각주를 후행 delta로 전송.
          const check = verifyCitations(full, allHits, question);
          if (check.unknownTitles.length || check.wrongArticles.length) {
            const warn = buildWarnFooter(check);
            if (warn) send({ type: "delta", text: warn });
            send({ type: "verify", unknownTitles: check.unknownTitles, wrongArticles: check.wrongArticles });
          }
          send({ type: "done" });
          recordUsage("knowledge", deep ? "deep" : "fast");
          logQuery({
            q: question, mode: deep ? "deep" : "fast", path: "llm", signals,
            citedTitles: allHits.map((h) => h.title ?? ""), counts: { text: textHits.length, vec: vecAdds.length, graph: graphAdds.length },
            gate: { ...check, retried: false }, stages, retry: retryMeta, latencyMs: Date.now() - t0,
          });
        } catch (e) {
          if (isGuardBlockedError(e)) recordUsage("knowledge", "blocked");
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
  }

  // ── 프롬프트(모드별) ──
  const system = deep ? DEEP_SYSTEM : undefined;
  let userPrompt = deep
    ? `【파악된 의도】\n${intent || "(질문 그대로)"}\n\n【근거 문서】(위계 상위→하위 순)\n${contextText}\n\n【질문】\n${question}\n\n위 근거만으로, 위계 상위→하위 순서로 체계적으로 답하세요.`
    : `아래는 사내 사규 문서입니다(위계 상위→하위 순으로 정렬됨).\n\n${contextText}\n\n질문: ${question}\n${HIERARCHY_GUIDE}\n위 문서에 나온 내용만 근거로 답하세요. 먼저 핵심에 간결히 직접 답한 뒤, 답을 지탱하는 규정은 「규정명」과 조문 번호·핵심 원문 발췌로 빠짐없이 인용하세요(누락 금지). 질문과 무관한 규정은 인용하지 마세요. 문서에 없는 내용은 추측하지 마세요.`;
  if (lowConfidence) {
    // 연성(주의) 밴드 — 근거 관련도가 낮을 수 있음을 모델에 명시(무관 규정 억지 인용 실측 결함의 프롬프트측 방어).
    // 문구 순화(D): "거절하라" 뉘앙스가 지시이행 좋은 모델에서 오거절을 유발(12B 실측 i=12) —
    // '있는 근거는 활용 + 불확실성 표기'로 방향 전환, 거절은 근거가 전혀 없을 때만.
    // 양방향 보호: '활용 유도'(오거절 방지)와 '무관 인용 금지'(억지 인용 방지)를 함께 명시 —
    // 금지 절이 빠지면 지시이행 좋은 모델(E4B)이 무관 규정까지 끌어쓰는 회귀 실측(P8, 2026-07-20).
    userPrompt += `\n\n(주의) 검색된 근거 문서가 질문과 직접 관련되지 않을 수 있습니다. 질문에 직접 답이 되는 근거만 활용하고, 질문과 무관한 규정은 인용하지 마세요. 근거가 부분적이면 '관련 근거가 제한적'임을 답변에 명시하세요. 근거가 전혀 답하지 못할 때만 "사규에서 확인되지 않습니다. 담당 부서에 문의해 주세요."라고 답하세요 — 답이 되는 근거가 있는데 거절하지는 마세요.`;
  }
  const maxTokens = deep ? 4096 : 3072;

  if (wantStream) {
    return sseResponse(
      guardedStreamChat({ messages: [{ role: "user", content: userPrompt }], system, ctx, maxTokens, temperature: 0.1, guardInput: question }),
    );
  }

  let answer: string;
  try {
    answer = await mark("llm", () => guardedChat({ messages: [{ role: "user", content: userPrompt }], system, ctx, maxTokens, temperature: 0.1, guardInput: question }));
  } catch (e) {
    if (isGuardBlockedError(e)) {
      recordUsage("knowledge", "blocked");
      return NextResponse.json({ error: e.block.reason, ruleId: e.block.ruleId }, { status: e.block.status });
    }
    throw e;
  }

  // ── 결정적 인용 게이트: 답변 인용 「규정명」·제N조를 근거 문서셋과 대조(감사 실측: 표기 100% 일치 기반).
  // 근거에 없는 규정명은 환각일 수도, '회수 누락'일 수도 있다 — 먼저 DB 실제 사규로 해석되면 원문을
  // 근거셋에 추가해 인용을 지우는 대신 검증 가능하게 만든다(재회수). 전부 해소되면 재생성 없이 원답변
  // 채택(추가 LLM 0회). 잔여 위반만 교정 재생성 1회, 재실패 시 삭제 대신 경고 각주(문장 절단 방지·정직 표시).
  let check = verifyCitations(answer, allHits, question);
  let gateRetried = false;
  let refetchedTitles: string[] = [];
  if (check.unknownTitles.length || check.wrongArticles.length) {
    let extraContext = "";
    if (check.unknownTitles.length) {
      try {
        const resolved = await resolveCitedTitles(check.unknownTitles);
        const have = new Set(allHits.map((h) => (h.title ?? "").replace(/\s+/g, "")));
        const wanted = [...new Set([...resolved.values()])].filter((t) => !have.has(t.replace(/\s+/g, ""))).slice(0, 2);
        const adds = (await fetchSeedDocsByTitles(wanted)) as RegHit[];
        if (adds.length) {
          for (const a of adds) (a as RegHit & { citeRefetch?: boolean }).citeRefetch = true;
          allHits.push(...adds);
          refetchedTitles = adds.map((a) => a.title ?? "").filter(Boolean);
          // 추가 원문은 재생성 프롬프트에만 쓰며, 원 컨텍스트 예산의 남은 방 안에서만 붙인다
          // (초과분은 Ollama가 프롬프트 '앞'부터 무음 절단 — 예산가드와 동일한 이유).
          const room = Math.max(0, Math.floor((env.LLM_NUM_CTX - maxTokens - 512) * 1.4) - userPrompt.length - 600);
          if (room > 500) {
            extraContext = buildContextText(question, adds, snippetLen, deep, [], vecArts);
            const cap = Math.min(6_000, room);
            if (extraContext.length > cap) extraContext = `${extraContext.slice(0, cap)}\n…[추가 근거 절단]`;
          }
          stages.push({ s: "cite-refetch", ms: 0, n: adds.length });
          check = verifyCitations(answer, allHits, question); // 원답변을 확장된 근거셋으로 재검증
        }
      } catch { /* 재회수 실패 → 기존 교정 경로 */ }
    }
    if (check.unknownTitles.length || check.wrongArticles.length) {
      gateRetried = true;
      try {
        const retryPrompt =
          `${userPrompt}${extraContext ? `\n\n【추가 근거 문서】(인용 검증을 위해 재회수됨)\n${extraContext}` : ""}\n\n${buildCorrection(check)}`;
        const retry = await mark("llm-retry", () => guardedChat({
          messages: [{ role: "user", content: retryPrompt }],
          system, ctx, maxTokens, temperature: 0.1, guardInput: question,
        }));
        const recheck = verifyCitations(retry, allHits, question);
        const worse = (c: typeof recheck) => c.unknownTitles.length + c.wrongArticles.length;
        if (worse(recheck) < worse(check)) { answer = retry; check = recheck; } // 개선됐을 때만 교체
      } catch { /* 재생성 실패 → 원답변 + 경고 각주 */ }
      const warn = buildWarnFooter(check);
      if (warn) answer += warn;
    }
  }

  // 재회수로 근거셋이 늘었으면 인용·참고 목록도 실제 근거와 일치하게 재조립(citeRefetch 표식 포함).
  const outCitations = refetchedTitles.length
    ? allHits.map((d) => ({
        id: d._id != null ? String(d._id) : "",
        title: d.title,
        category: "regulation" as const,
        year: d.year ?? "",
        articles: pickArticlesForContext(d.articles, question, citeTerms, 3, 0, vecArts?.get(d.title ?? "")).map((a) => a.name).filter((n): n is string => !!n),
        ...(d.viaGraph ? { viaGraph: true } : {}),
        ...(d.vecHit ? { vecHit: true } : {}),
        ...((d as RegHit & { citeRefetch?: boolean }).citeRefetch ? { citeRefetch: true } : {}),
      }))
    : citations;
  const outReferences = refetchedTitles.length
    ? allHits.map((h) => ({
        title: h.title,
        revisionInfo: h.year ?? "",
        id: h._id != null ? String(h._id) : undefined,
        category: "regulation" as const,
        ...(h.viaGraph ? { viaGraph: true, relatedFrom: h.viaGraph.from } : {}),
        ...(h.vecHit ? { vecHit: true } : {}),
        ...((h as RegHit & { citeRefetch?: boolean }).citeRefetch ? { citeRefetch: true } : {}),
      }))
    : references;
  logQuery({
    q: question, mode: deep ? "deep" : "fast", path: "llm", signals,
    citedTitles: allHits.map((h) => h.title ?? ""), counts: { text: textHits.length, vec: vecAdds.length, graph: graphAdds.length },
    gate: { ...check, retried: gateRetried, ...(refetchedTitles.length ? { refetched: refetchedTitles } : {}) }, stages, retry: retryMeta, latencyMs: Date.now() - t0,
  });
  recordUsage("knowledge", deep ? "deep" : "fast");
  return NextResponse.json({
    ok: true, answer, references: outReferences, citations: outCitations, intent, mode: deep ? "deep" : "fast",
    ...(lowConfidence ? { lowConfidence: true } : {}),
    ...(body?.diag ? { diag: { signals, stages, gate: { unknownTitles: check.unknownTitles, wrongArticles: check.wrongArticles, retried: gateRetried, refetched: refetchedTitles } } } : {}),
  });
}
