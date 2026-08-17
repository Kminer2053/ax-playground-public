/**
 * 사규 RAG 공통: 한국어 자연어 질의에서 토큰 추출·문서 blob·하이브리드 스코어.
 */

/** 한글 조사·어미를 잘라 조항 매칭에 쓸 토큰 보강. 주격(이/가)·여격(로/께서) 등 흔한 조사 포함. */
function stripKoreanParticle(token: string): string {
  let s = token.toLowerCase();
  for (let i = 0; i < 4; i++) {
    // 긴 조사 먼저(에서/으로/께서/부터/까지/에게) → 단음절(이/가/은/는…). 과다절단 토큰은 상위에서 길이<2 필터로 제거.
    const next = s.replace(/(에서|으로|께서|부터|까지|에게|이라고|이라|라고|짜리|의|은|는|을|를|이|가|에|와|과|도|만|로|라|께)$/u, "");
    if (next === s) break;
    s = next;
  }
  return s;
}

/** 질문에서 검색/재랭킹용 토큰 (공백 분리 + 너무 짧은 것 제외) */
export function queryTermsFromQuestion(q: string): string[] {
  const raw = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const terms = raw.split(" ").filter((t) => t.length >= 2);
  if (terms.length > 0) return terms;
  return raw ? [raw] : [];
}

/**
 * 재랭킹·조항 선택용 키워드 확장 (인사/휴가 등 질문에서 조사 제거 + 동의어).
 */
export function expandTermsForRag(q: string, terms: string[]): string[] {
  const set = new Set<string>();
  const ql = q.toLowerCase().replace(/\s+/g, "");
  for (const t of terms) {
    const low = t.toLowerCase();
    if (low.length >= 2) set.add(low);
    const stripped = stripKoreanParticle(low);
    if (stripped.length >= 2) set.add(stripped);
  }
  const hrLex = [
    "연차",
    "연차휴가",
    "휴가",
    "입사",
    "신입",
    "신입사원",
    "경력",
    "수습",
    "최초",
    "발생",
    "부여",
    "사용",
    "취업규칙",
    "인사",
    "육아휴직",
    "육아",
    "휴직",
    "남녀고용평등",
    "고용평등",
    "배우자",
    "출산",
    "육아기",
    "가족돌봄",
  ];
  for (const w of hrLex) {
    if (ql.includes(w.replace(/\s+/g, "")) || q.toLowerCase().includes(w)) set.add(w);
  }
  // 결재선·전결권자 질의("어디까지 결재", "누가 승인") → 위임전결 도메인 어휘.
  // 실무 어휘는 '결재'인데 규정 어휘는 '전결'이라 위임전결규정이 회수 자체가 안 되던 격차 해소.
  if (/결재|전결|승인권|재가|품의/.test(ql)) for (const w of ["전결", "전결권자", "위임전결", "결재"]) set.add(w);
  // 실무 구어 ↔ 규정 용어 미니 렉시콘(골드셋 실패 사례 기반 — 과도한 일반 사전은 오염 위험이라 최소 유지)
  if (/돈.{0,6}(빌리|꾸|차용)|차용|빌려/.test(ql)) for (const w of ["금전대차", "차용"]) set.add(w);
  if (/구매/.test(ql)) set.add("구입"); // 위임전결·양정표 원문 어휘는 "구입"
  if (/구입/.test(ql)) set.add("구매"); // 회계·계약 쪽은 "구매" 혼용
  // 아라비아 금액("2000만원")은 규정 원문 표기("이천만원")로도 검색되게 한글 수사 토큰 추가
  for (const t of [...set]) for (const k of arabicAmountToKorTokens(t)) set.add(k);
  return [...set].filter((t) => t.length >= 2);
}

/** "2000만원"·"3천만원"·"1억" → 규정 원문 관행 표기("이천만원"·"삼천만원"·"일억원") 토큰. 해석 불가·십 단위 미만은 빈 배열. */
function arabicAmountToKorTokens(tok: string): string[] {
  let s = tok.replace(/원$/, "");
  let v = 0;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+)억/))) { v += parseInt(m[1], 10) * 10000; s = s.slice(m[0].length); }
  if (s) {
    if ((m = s.match(/^(\d+)천만?$/))) v += parseInt(m[1], 10) * 1000;
    else if ((m = s.match(/^(\d+)백만?$/))) v += parseInt(m[1], 10) * 100;
    else if ((m = s.match(/^(\d+)만$/))) v += parseInt(m[1], 10);
    else if (/^\d+$/.test(s) && tok.endsWith("만원")) v += parseInt(s, 10);
    else return [];
  }
  if (v <= 0) return [];
  const D = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  let k = "";
  if (eok) { if (eok > 9) return []; k += D[eok] + "억"; }
  if (man) {
    const ch = Math.floor(man / 1000);
    const b = Math.floor((man % 1000) / 100);
    if (man % 100 !== 0) return []; // 십 단위 미만은 규정 관행 표기가 없어 생략
    if (ch) k += D[ch] + "천";
    if (b) k += D[b] + "백";
    k += "만";
  }
  return k ? [k + "원"] : [];
}

/** 재순위·하이브리드용: 거의 모든 규정에 나와 매칭이 오염되는 일반어 */
const KOREAN_RAG_STOPWORDS = new Set([
  "절차",
  "안내",
  "방법",
  "내용",
  "신청",
  "처리",
  "관련",
  "확인",
  "대한",
  "경우",
  "위해",
  "알려",
  "무엇",
  "어떻게",
  "언제",
  "어디",
  "입니까",
  "입니다",
  "주세요",
  "해주세요",
  "사항",
  "기준",
  "적용",
  "운영",
  "실시",
  "이행",
  "준수",
  "제출",
  "문의",
  "담당",
  "별지",
  "서식",
  "규정",
  "지침",
  "세부",
  "별도",
  "포함",
  "대상",
  "필요",
  "가능",
  "수립",
  "관리",
]);

/**
 * JE 조 스니펫 점수: 일반어(절차·안내 등)는 낮추고, 긴 복합어(육아휴직 등)는 높임.
 * 참조 리포는 키워드만 쓰지만, 한국어 질의에서 일반어가 조문 순위를 오염하는 문제 보완.
 */
export function weightSnippetToken(term: string): number {
  const t = term.toLowerCase();
  if (t.length < 2) return 0;
  if (KOREAN_RAG_STOPWORDS.has(t)) return 0.12;
  if (t.length >= 5) return 4;
  if (t.length >= 4) return 2.2;
  return 1;
}

/**
 * 질문에서 의미 있는 토큰만 남김. '절차·안내'만 맞는 무관 문서 상위 노출 방지.
 * 추출 결과가 비면 원문 토큰(짧은 질의)으로 폴백.
 */
export function semanticTermsForRag(q: string): string[] {
  const expanded = expandTermsForRag(q, queryTermsFromQuestion(q));
  const filtered = expanded.filter((t) => !KOREAN_RAG_STOPWORDS.has(t) && t.length >= 2);
  if (filtered.length > 0) return [...new Set(filtered)];
  const raw = queryTermsFromQuestion(q).filter((t) => t.length >= 2 && !KOREAN_RAG_STOPWORDS.has(t));
  if (raw.length > 0) return [...new Set(raw)];
  return [...new Set(expanded.filter((t) => t.length >= 2))];
}

/**
 * MongoDB $text·RegExp 회수용 토큰: 의미 토큰 우선 + 키워드에서 불용어 제거.
 * 질문 전체를 그대로 쓰면 '절차·안내' 등으로 무관 문서가 $text 상위에 오는 문제 완화.
 */
export function retrievalSearchTokens(q: string): string[] {
  const sem = semanticTermsForRag(q);
  const rawKw = queryTermsFromQuestion(q)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2 && !KOREAN_RAG_STOPWORDS.has(t));
  const merged = [...new Set([...sem, ...rawKw])].filter((t) => t.length >= 2);
  if (merged.length > 0) return merged.slice(0, 14);
  const fallback = queryTermsFromQuestion(q).filter((t) => t.length >= 2);
  if (fallback.length > 0) return [...new Set(fallback)].slice(0, 14);
  const one = q.trim();
  return one.length >= 2 ? [one] : [];
}

/** 문서 blob이 질문의 의미 토큰·구문 중 하나라도 만족하는지 (회수 후 필터) */
export function documentMatchesSemanticQuery(q: string, blobLower: string): boolean {
  const terms = semanticTermsForRag(q);
  if (terms.length === 0) return true;
  for (const t of terms) {
    if (t.length >= 2 && blobLower.includes(t)) return true;
  }
  return compactPhraseMatch(q, blobLower) > 0;
}

/** 자주 쓰는 질문형 어미·불용어 제거 후 임베딩용 짧은 쿼리 (의미 벡터 품질 보조) */
export function queryForEmbedding(q: string): string {
  let s = q.trim();
  s = s.replace(/\s+/g, " ");
  // 끝부분 질문 패턴 (과도하게 길지 않게 일부만)
  s = s.replace(
    /\s*(입니다|입니까|인가요|인지|나요|까요|습니까|해주세요|주세요|알려주세요|알려줘|알려|되나요|되나|있나요|있습니까|어떻게|무엇|언제|어디|누구|왜)\s*$/gi,
    ""
  );
  s = s.replace(/^[은는이가을를의에와과도만도]\s+/g, "");
  const t = s.trim();
  return t.length >= 4 ? t : q.trim();
}

export function regulationTextBlob(r: {
  title?: string;
  revisionInfo?: string;
  articles?: { name?: string; fullText?: string }[];
}): string {
  const parts = [
    r.title ?? "",
    r.revisionInfo ?? "",
    ...(r.articles?.map((a) => `${a.name ?? ""} ${a.fullText ?? ""}`) ?? []),
  ];
  return parts.join(" ").toLowerCase();
}

/** 참조 `rag_regulation` 문서용: title + year + 본문(조문 배열 우선, 없으면 통본 content) */
export function ragRegulationTextBlob(r: {
  title?: string;
  year?: string;
  content?: string;
  articles?: { name?: string; fullText?: string }[];
}): string {
  let docBody = "";
  if (r.articles && r.articles.length > 0) {
    docBody = r.articles.map((a) => `${a.name ?? ""} ${a.fullText ?? ""}`).join(" ");
  } else {
    docBody = r.content ?? "";
  }
  return `${r.title ?? ""} ${r.year ?? ""} ${docBody}`.toLowerCase();
}

export function regulationTextBlobCompact(r: {
  title?: string;
  revisionInfo?: string;
  articles?: { name?: string; fullText?: string }[];
}): string {
  return regulationTextBlob(r).replace(/\s+/g, "");
}

/** 토큰 일치 비율 0~1 */
export function termMatchRatio(blobLower: string, terms: string[]): number {
  if (terms.length === 0) return 1;
  let m = 0;
  for (const t of terms) {
    if (t.length >= 2 && blobLower.includes(t)) m++;
  }
  return m / terms.length;
}

/** 공백 제거한 한글 연속 일치 (복합어·띄어쓰기 불일치 보완) */
export function compactPhraseMatch(q: string, blobLower: string): number {
  const qc = q.toLowerCase().replace(/\s+/g, "");
  if (qc.length < 3) return 0;
  const bc = blobLower.replace(/\s+/g, "");
  if (bc.includes(qc)) return 1;
  // 부분 구간: 질문에서 5자 이상 연속이 본문에 있으면 가산
  if (qc.length >= 8) {
    for (let i = 0; i + 5 <= qc.length; i++) {
      const sub = qc.slice(i, i + 6);
      if (bc.includes(sub)) return 0.5;
    }
  }
  return 0;
}

/**
 * 벡터 유사도(cos 0~1)와 키워드 일치를 결합한 하이브리드 점수.
 * strict every() 필터 대신 사용.
 */
export function hybridRegulationScore(cosine: number, q: string, blobLower: string, terms: string[]): number {
  const c = Math.max(0, Math.min(1, cosine));
  const tr = termMatchRatio(blobLower, terms);
  const cp = compactPhraseMatch(q, blobLower);
  /** 의미 토큰이 하나도 없으면 코사인만으로 상위에 오는 것 방지 */
  if (terms.length > 0 && tr === 0 && cp === 0) {
    return c * 0.06;
  }
  return c * (0.55 + 0.35 * tr + 0.1 * cp) + tr * 0.12 + cp * 0.08;
}

export type ArticleLike = { name?: string; fullText?: string; tableGloss?: string };
/** 벡터(임베딩) 조문 힌트 — vectorSearchSeeds.topArticles와 동형. */
export type ArticleVecHint = { name?: string; score: number };
/** 힌트 채택 코사인 하한(bge-m3 기준). 이 이상이면 의미적으로 질의와 강결합으로 보고 슬롯 보장. */
export const VEC_HINT_MIN = 0.5;

/**
 * 질의↔조문 관련도(이진 매칭 + 제목 가중). 출현빈도 합산이 아니라 포함여부라 조문 길이에 편향되지 않음
 * — 1만자급 별표(일반조건)가 빈도만으로 짧은 정답 조문을 밀어내던 문제의 해법. 인용표시·컨텍스트 선택 공용.
 */
export function scoreArticleForQuery(a: ArticleLike, q: string, terms: string[]): number {
  const qLower = q.toLowerCase();
  const qc = qLower.replace(/\s+/g, "");
  const name = (a.name ?? "").toLowerCase();
  // 표 해석(tableGloss)도 매칭 표면에 포함 — 한글 금액의 아라비아 병기·행 명제가 질의 표기와 만난다
  const body = `${a.fullText ?? ""} ${a.tableGloss ?? ""}`.toLowerCase();
  const blob = `${name} ${body}`;
  const blobC = blob.replace(/\s+/g, "");
  let score = 0;
  for (const t of terms) {
    if (t.length >= 2) {
      if (name.includes(t)) score += 3;
      if (body.includes(t)) score += 1;
      if (blobC.includes(t.replace(/\s+/g, ""))) score += 1;
    }
  }
  if (qc.length >= 4 && blobC.includes(qc)) score += 5;
  if (qLower.length >= 4 && blob.includes(qLower.slice(0, Math.min(20, qLower.length)))) score += 2;
  // 휴가·연차 질의 시 조항명/본문에 휴가·연차가 있으면 가산
  if (/(연차|휴가|입사|신입|경력)/u.test(q) && /(연차|휴가|휴직|입사|경력|수습)/u.test(blob)) score += 4;
  // 기준 조회형 질의(전결·양정·등급·한도·누가·얼마…)는 원칙 조문(제N조)이 아니라 명제화된
  // 기준표(별표, tableGloss 보유)에 실제 답이 있는 경우가 많다 — 대형 별표가 밀도 보정에 밀리는 것 교정
  if (score > 0 && a.tableGloss && /(전결|결재|징계|양정|등급|배분|한도|요율|수수료|기준|누가|얼마|며칠|몇)/u.test(q)) score += 3;
  return score;
}

/**
 * 벡터힌트 → 실제 조문 매핑 + 키워드 관련도로 재정렬해 상위 max개 선택.
 * 코사인 초박빙(±0.01) 상황에서 벡터순만 믿으면 진짜 정답 조문(3위)이 잘리는 문제 방지 —
 * 힌트 후보(top3)는 벡터가 주되, 그 안의 우선순위는 키워드 관련도가 정한다.
 */
export function selectHintedArticles(list: ArticleLike[], q: string, terms: string[], vecHints?: ArticleVecHint[], max = 2): ArticleLike[] {
  // 양쪽 trim 매칭 — 조문명 끝공백(원문 유래)이 있는 4건에서 벡터 힌트가 미스나던 결함(감사 R12)
  const byName = new Map(list.map((a) => [(a.name ?? "").trim(), a]));
  const cands: ArticleLike[] = [];
  for (const h of (vecHints ?? []).filter((x) => x.score >= VEC_HINT_MIN).slice(0, 3)) {
    const a = h.name ? byName.get(h.name.trim()) : undefined;
    if (a && !cands.includes(a)) cands.push(a);
  }
  return cands
    .map((a, i) => ({ a, kw: scoreArticleForQuery(a, q, terms), i }))
    .sort((x, y) => (y.kw - x.kw) || (x.i - y.i)) // 키워드 관련도 우선, 동점은 벡터순 유지
    .slice(0, max)
    .map((x) => x.a);
}

/** 질문과 가장 관련 높은 조항부터 스니펫 선택. vecHints(임베딩 상위 조문)는 상위 2개 슬롯 보장 — 키워드가 못 잡는 의미 정답 조문 유실 방지. */
export function pickArticlesForContext(
  articles: ArticleLike[] | undefined,
  q: string,
  terms: string[],
  maxArticles: number,
  maxCharsPerArticle: number,
  vecHints?: ArticleVecHint[]
): ArticleLike[] {
  const list = Array.isArray(articles) ? [...articles] : [];
  if (list.length === 0) return [];

  const hinted = selectHintedArticles(list, q, terms, vecHints);

  const scored = list.map((a) => ({ a, score: scoreArticleForQuery(a, q, terms) }));
  scored.sort((x, y) => y.score - x.score);

  const picked: ArticleLike[] = [...hinted];
  for (const { a } of scored) {
    if (picked.length >= maxArticles) break;
    if (!picked.includes(a)) picked.push(a);
  }
  return picked.slice(0, maxArticles).map((a) => ({
    name: a.name,
    fullText: (a.fullText ?? "").slice(0, maxCharsPerArticle),
  }));
}
