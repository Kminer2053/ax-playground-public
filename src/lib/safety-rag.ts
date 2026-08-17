/**
 * 매장 안전 Q&A 키워드 검색(RAG) — 매장안전챗봇 원본 rag.ts 이식, 폐쇄망용으로 외부 의존 제거.
 * MongoDB/임베딩/Gemini 없이 [safety-qa.ts]의 107건 JSON만으로 동작한다(server 전용).
 *
 * 흐름: 동의어 정규화 → ① 패턴 정확매칭 ② 질문 유사매칭 ③ 키워드 IDF 스코어링(상위 3건).
 * 반환 context를 채팅 프롬프트에 【참고 자료】로 주입해 답변을 안전DB에 근거시킨다.
 */
import { safetyQa, type SafetyQa } from "./safety-qa";

/** 동의어·표기차이 정규화 — 같은 의미를 표준어로 통일해 매칭 누락을 줄인다. */
const SYNONYM_MAP: Array<[RegExp, string]> = [
  [/천정/g, "천장"],
  [/물(?:이)?(?:새|샌|새는|새요|새서|새어|흘러|흐르|흐른|흘렀|떨어져|떨어진|떨어졌|떨어집)[가-힣]*/g, "물떨어짐"],
  [/누수/g, "물떨어짐"],
  [/점검(?:요령|방법|법|하는법|하는방법)/g, "점검"],
  [/(?:예방|방지|대비)(?:대책|방법|책|요령)/g, "예방"],
  [/낙상사고|전도사고/g, "넘어짐"],
  [/넘어(?:졌|진|지|져|집)[가-힣]*/g, "넘어짐"],
  [/절단사고|베이는|베인|베였|베여/g, "베임"],
  [/(?:불|화재)(?:을|를|은|는|이|가)?(?:어케끔|어떻게끄|어케끄|끄는법|끄는방법|끄지|끄기|끄[가-힣]*|꺼[가-힣]*|끔)/g, "화재진압"],
  [/대피(?:요령|방법|법)/g, "대피"],
  [/한여름|무더위|폭염주의보|폭염경보/g, "폭염"],
  [/겨울철|동절기|한파/g, "동절기"],
  [/위험성평가|리스크평가/g, "위험성평가"],
  [/근골격계질환|근골격/g, "근골격계"],
  [/유효기간|유효기한|유통기한|내용연수/g, "사용기한"],
  [/교체주기|교환주기/g, "사용기한"],
];

function normalize(text: string): string {
  let s = text.toLowerCase().replace(/\s+/g, "");
  for (const [re, rep] of SYNONYM_MAP) s = s.replace(re, rep);
  return s;
}

/** 의문사·정중표현·범용어 — 이런 단어만 겹친 매칭은 주제 적중이 아니므로 점수에서 제외. */
const STOPWORDS = new Set([
  "어떻게", "언제", "무엇", "뭐", "방법", "사용", "사용법", "가이드",
  "알려줘", "알려주세요", "주세요", "알려", "대해", "대한", "관련",
  "인가요", "건가요", "해야", "해도", "되나요", "하나요", "요령",
  "정도", "경우", "무슨", "어떤", "그냥", "좀", "please",
  // 비주제 어미·표현(랭킹 노이즈 제거)
  "있나요", "있어요", "있을까요", "같아요", "거예요", "어떡하죠", "어떡해요", "어떡해", "할까요", "될까요",
]);

const PARTICLE_RE = /^(.*?)(을|를|이|가|은|는|에서|에게|에|의|도|으로|로|와|과|만|이나|나|까지|부터|보다|처럼|마다|들)$/;
function stripParticle(tok: string): string {
  const m = tok.match(PARTICLE_RE);
  return m && m[1].length >= 1 ? m[1] : tok;
}

/** 길이 1이라도 의미를 갖는 안전 도메인 단일 글자 명사. */
const SINGLE_CHAR_TOPICS = new Set(["불", "물", "열", "비", "땀", "손", "눈"]);

/** 사용자 질문 → 내용어 키워드(조사 제거·동의어 정규화·불용어 제거·복합어 분해). */
function extractKeywords(userText: string): string[] {
  const tokens = userText.replace(/[^가-힣a-zA-Z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (const raw of tokens) {
    const tok = normalize(stripParticle(raw.toLowerCase()));
    if (tok.length === 0 || STOPWORDS.has(tok)) continue;
    if (tok.length >= 2) out.add(tok);
    else if (SINGLE_CHAR_TOPICS.has(tok)) out.add(tok);
    // 4글자 이상 한글 복합어 → 2글자 슬라이딩 윈도우 sub-token
    if (tok.length >= 4 && /^[가-힣]+$/.test(tok)) {
      for (let i = 0; i <= tok.length - 2; i++) {
        const sub = tok.slice(i, i + 2);
        if (!STOPWORDS.has(sub)) out.add(sub);
      }
    }
  }
  // 다토큰 동의어 발동용 — 전체 텍스트 normalize 결과를 2글자 sub-token으로 분해
  const whole = normalize(userText);
  for (let i = 0; i <= whole.length - 2; i++) {
    const sub = whole.slice(i, i + 2);
    if (/^[가-힣]{2}$/.test(sub) && !STOPWORDS.has(sub)) out.add(sub);
  }
  return [...out];
}

// 모듈 로드 시 1회: 제목(q+patterns)·본문(actions+cautions+report) 정규화 풀 사전 계산
const TITLE_POOLS: string[] = safetyQa.map((qa) => normalize([qa.q, ...qa.patterns].join(" ")));
const BODY_POOLS: string[] = safetyQa.map((qa) => normalize([...qa.actions, ...qa.cautions, qa.report].join(" ")));
const CORPUS_N = safetyQa.length;
const DF_CACHE = new Map<string, number>();

/** 키워드 희소도(idf) — 흔한 단어는 낮게, 드문 단어는 높게 가중. */
function idf(kw: string): number {
  let df = DF_CACHE.get(kw);
  if (df === undefined) {
    df = 0;
    for (let i = 0; i < CORPUS_N; i++) if (TITLE_POOLS[i].includes(kw) || BODY_POOLS[i].includes(kw)) df++;
    DF_CACHE.set(kw, df);
  }
  return df === 0 ? 0 : Math.log(1 + CORPUS_N / df);
}

/** Q&A → 프롬프트 주입용 컨텍스트 텍스트. */
function formatQaAsContext(qa: SafetyQa): string {
  const parts = [`[${qa.category}] ${qa.q} (기본 위험도: ${qa.risk_default})`];
  if (qa.actions.length) parts.push("즉시 조치: " + qa.actions.join(" / "));
  if (qa.cautions.length) parts.push("주의사항: " + qa.cautions.join(" / "));
  if (qa.report) parts.push("보고: " + qa.report);
  return parts.join("\n");
}

export type SafetyRetrieval = {
  /** 프롬프트 주입용 컨텍스트(없으면 ""). */
  context: string;
  /** 제목(q+patterns) 적중 = 강한 주제 적중. */
  matched: boolean;
  matchedCategory: string | null;
};

/**
 * 사용자 질문에 대한 안전DB 검색.
 * ① 패턴 정확매칭 → ② 질문 유사매칭 → ③ 키워드 IDF 스코어링 상위 3건.
 */
export function retrieveSafetyContext(userText: string): SafetyRetrieval {
  const normalized = normalize(userText);

  // ① 패턴 정확 매칭
  for (const qa of safetyQa) {
    for (const p of qa.patterns) {
      const pNorm = normalize(p);
      if (pNorm && (normalized.includes(pNorm) || pNorm.includes(normalized))) {
        return { context: formatQaAsContext(qa), matched: true, matchedCategory: qa.category };
      }
    }
  }

  // ② 질문 유사 매칭
  for (const qa of safetyQa) {
    const qNorm = normalize(qa.q);
    if (qNorm && (normalized.includes(qNorm) || qNorm.includes(normalized))) {
      return { context: formatQaAsContext(qa), matched: true, matchedCategory: qa.category };
    }
  }

  // ③ 키워드 스코어링 (제목 적중 2배 가중)
  const keywords = extractKeywords(userText);
  if (keywords.length === 0) return { context: "", matched: false, matchedCategory: null };

  const scored: Array<{ qa: SafetyQa; score: number; titleHit: boolean }> = [];
  for (let i = 0; i < CORPUS_N; i++) {
    let score = 0;
    let titleHit = false;
    for (const kw of keywords) {
      const w = idf(kw);
      if (w === 0) continue;
      if (TITLE_POOLS[i].includes(kw)) { score += w * 2; titleHit = true; }
      else if (BODY_POOLS[i].includes(kw)) score += w;
    }
    if (score > 0) scored.push({ qa: safetyQa[i], score, titleHit });
  }
  if (scored.length === 0) return { context: "", matched: false, matchedCategory: null };

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  return {
    context: scored.slice(0, 3).map((s) => formatQaAsContext(s.qa)).join("\n\n"),
    matched: top.titleHit,
    matchedCategory: top.qa.category,
  };
}

/**
 * 메인 추천 카드용 풀 — 자기 질문이 '자기 항목으로' 강하게 매칭되는 항목만 담는다.
 * (질문이 모호해 다른 항목에 걸리거나 매칭이 약하면 답변 구조가 빈약해질 수 있어 추천에서 제외)
 */
export const strongQaPool: SafetyQa[] = safetyQa.filter((d) => {
  const r = retrieveSafetyContext(d.q);
  return r.matched && r.matchedCategory === d.category;
});
