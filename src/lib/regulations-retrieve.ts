/**
 * 참조 AX_Portal(lawRagRetrieve)와 동일: $text + 키워드 RegExp 하이브리드 회수,
 * LLM용 본문은 DB 조문(articles) 우선, 없으면 통본 content + 「제 N 조」 스니펫.
 * 임베딩 미사용.
 */
import { RagRegulationModel } from "@/models/RagRegulation";
import { JE_SPLIT } from "@/lib/regulations-articles";
import {
  retrievalSearchTokens,
  semanticTermsForRag,
  weightSnippetToken,
  scoreArticleForQuery,
  selectHintedArticles,
  type ArticleVecHint,
} from "@/lib/regulations-rag";
import { pickGlossLines } from "@/lib/regulations-table-gloss";

export function extractKeywordsFromQuery(q: string): string[] {
  const s = String(q || "").trim();
  if (!s) return [];
  const parts = s.split(/[\s,.;:'"!?，、]+/).filter((w) => w.length >= 2);
  return [...new Set(parts)].slice(0, 12);
}

/**
 * 검색 코퍼스 필터 — 외부규범(법령·행정규칙)은 기본 회수에서 제외한다(ONTOLOGY.md §5 격리 원칙).
 * 외부규범은 조문 직행·근거보기(제목 조회)로만 노출되고, 질의 회수에 섞이면 사규 recall이 오염된다.
 */
export const RETRIEVAL_CORPUS_FILTER = { category: { $nin: ["법령", "행정규칙"] } } as const;

/** MongoDB $text 검색용 문자열 */
export function sanitizeMongoTextSearch(s: string): string {
  let t = String(s || "")
    .replace(/\\/g, " ")
    .replace(/"/g, " ")
    .replace(/[-]/g, " ");
  try {
    t = t.replace(/[^\p{L}\p{N}\s]/gu, " ");
  } catch {
    t = t.replace(/[^0-9A-Za-z가-힣\s]/g, " ");
  }
  return t.replace(/\s+/g, " ").trim().slice(0, 220);
}

/**
 * MongoDB $text 검색어: 의미 토큰만 이어 붙임(질문 전체 금지 → 일반어 오염 방지).
 */
export function buildMongoTextSearchQuery(question: string): string {
  const q = String(question || "").trim();
  if (!q) return "";
  const terms = semanticTermsForRag(q);
  const joined = terms.length > 0 ? terms.join(" ") : q;
  return sanitizeMongoTextSearch(joined);
}

function normalizeTextScore(s: unknown): number {
  return Math.log1p(Math.max(0, Number(s) || 0)) * 15;
}

/** 조문 블록 점수: 의미 토큰·긴 복합어에 가중 (절차/안내 난립 방지) */
function scoreChunkAgainstTokens(chunk: string, tokens: string[]): number {
  const lower = String(chunk || "").toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (t.length < 2) continue;
    const sub = t.toLowerCase();
    const w = weightSnippetToken(t);
    let i = 0;
    let hits = 0;
    while ((i = lower.indexOf(sub, i)) !== -1) {
      score += w;
      hits++;
      i += sub.length;
      if (hits > 45) break;
    }
  }
  return score;
}

function truncateHead(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

export function snippetByJeSectionsAndHits(content: string, tokens: string[], maxLen: number): string {
  const text = String(content || "");
  if (!text.length) return "";
  if (text.length <= maxLen) return text;
  if (!tokens.length) return truncateHead(text, maxLen);

  const sections = text.split(JE_SPLIT).filter(Boolean);
  if (sections.length < 2) {
    return snippetAroundKeywordHits(text, tokens, maxLen);
  }

  const ranked = sections
    .map((chunk) => ({ chunk, score: scoreChunkAgainstTokens(chunk, tokens) }))
    .sort((a, b) => b.score - a.score);

  const picked: string[] = [];
  let total = 0;
  for (const { chunk, score } of ranked) {
    if (score === 0 && picked.length > 0) break;
    if (score === 0 && picked.length === 0) continue;
    const need = chunk.length + (picked.length ? 20 : 0);
    if (total + need > maxLen && picked.length > 0) break;
    picked.push(chunk);
    total += need;
    if (total >= maxLen * 0.9) break;
  }

  if (!picked.length) {
    return snippetAroundKeywordHits(text, tokens, maxLen);
  }

  let out = picked.join("\n…\n");
  if (out.length > maxLen) {
    out = `${out.slice(0, maxLen - 20)}\n…[생략]…`;
  }
  return out;
}

export function snippetAroundKeywordHits(content: string, tokens: string[], maxLen: number): string {
  const text = String(content || "");
  if (!text.length) return "";
  if (text.length <= maxLen) return text;
  const lower = text.toLowerCase();
  // 토큰별 히트 상한(4)로 배분 — 빈출 토큰(예: "수의계약")이 전체 캡을 독식해
  // 희소 정답 토큰(예: 조문 꼬리 신설항의 "감사원")의 히트가 수집조차 안 되던 문제 방지.
  const hits: number[] = [];
  for (const t of tokens) {
    if (t.length < 2) continue;
    const sub = t.toLowerCase();
    let idx = lower.indexOf(sub);
    let per = 0;
    while (idx !== -1) {
      hits.push(idx + Math.floor(sub.length / 2));
      per++;
      idx = lower.indexOf(sub, idx + 1);
      if (per >= 4) break;
    }
    if (hits.length >= 16) break;
  }
  if (!hits.length) return truncateHead(text, maxLen);

  hits.sort((a, b) => a - b);
  const clusters: { peak: number; min: number; max: number; count: number }[] = [];
  for (const h of hits) {
    const last = clusters[clusters.length - 1];
    if (!last || h - last.peak > 1200) {
      clusters.push({ peak: h, min: h, max: h, count: 1 });
    } else {
      last.peak = Math.round((last.peak + h) / 2);
      last.min = Math.min(last.min, h);
      last.max = Math.max(last.max, h);
      last.count++;
    }
  }

  const half = Math.floor(maxLen / 2) - 30;
  // 히트 밀도순 상위 2개 창(앞쪽 우선이 아니라 밀도 우선 — 정답이 문서 꼬리에 있어도 창 확보), 표시 순서는 원문 위치순
  const windows = clusters
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (y.c.count - x.c.count) || (x.i - y.i))
    .slice(0, 2)
    .sort((x, y) => x.i - y.i)
    .map(({ c }) => c)
    .map((c) => {
    const center = c.peak;
    let s = Math.max(0, center - half);
    const e = Math.min(text.length, s + maxLen);
    s = Math.max(0, e - maxLen);
    return { s, e };
  });

  const parts = windows.map(({ s, e }) => {
    let slice = text.slice(s, e);
    if (s > 0) slice = `…${slice}`;
    if (e < text.length) slice = `${slice}…`;
    return slice;
  });

  let joined = parts.join("\n\n---\n\n");
  if (joined.length > maxLen + 100) {
    joined = `${joined.slice(0, maxLen - 10)}…`;
  }
  return joined;
}

function formatArticleBlock(a: { name: string; fullText: string }): string {
  const body = (a.fullText ?? "").trim();
  return body ? `${a.name}\n${body}` : a.name;
}

function scoreArticleAgainstTokens(
  article: { name: string; fullText: string },
  tokens: string[],
): number {
  const chunk = `${article.name}\n${article.fullText ?? ""}`;
  return scoreChunkAgainstTokens(chunk, tokens);
}

/**
 * DB에 저장된 조문(articles)만으로 스니펫 구성 — 통본 split 없이 조 단위 선택.
 *
 * 조문 선택 원칙(인용표시 pickArticlesForContext와 동일 스코어러로 통일):
 *  - 관련도 = scoreArticleForQuery(이진 매칭 + 제목 가중) — 출현빈도 합산은 1만자급 별표(일반조건)가
 *    짧은 정답 조문을 밀어내는 길이편향이 있어 1차 기준에서 제외(동점 시 밀도 보정용으로만).
 *  - vecHints(임베딩 상위 조문, cos≥VEC_HINT_MIN)는 상위 2개 슬롯 보장 — 키워드가 못 잡는 의미 정답 유실 방지.
 *  - 조문당 예산 캡(maxLen 50%) + 초과 조문은 히트 문장 중심 창(windowing)으로 압축 —
 *    한 블록이 예산을 독식·꼬리 잘림으로 나머지 조문(개정 ⑦⑧항 등 꼬리 포함)이 통째로 유실되던 문제 방지.
 */
export function buildSnippetFromArticles(
  articles: { name: string; fullText?: string; order?: number; tableGloss?: string }[] | undefined,
  tokens: string[],
  maxLen: number,
  opts?: { q?: string; vecHints?: ArticleVecHint[] },
): string | null {
  if (!articles?.length) return null;
  const normalized = [...articles]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((a) => ({
      name: String(a.name ?? "").trim() || "조항",
      fullText: String(a.fullText ?? ""),
      tableGloss: a.tableGloss ? String(a.tableGloss) : undefined,
    }));

  const q = opts?.q ?? tokens.join(" ");
  const ranked = normalized
    .map((a) => ({
      a,
      score: scoreArticleForQuery(a, q, tokens),
      // 동점 보정: 출현빈도를 길이로 눌러(밀도) 짧고 밀도 높은 조문 우선
      dens: scoreArticleAgainstTokens(a, tokens) / Math.sqrt(1 + a.fullText.length / 800),
    }))
    .sort((x, y) => (y.score - x.score) || (y.dens - x.dens));

  // 벡터 힌트 조문(의미 최상위) 우선 편성 — 힌트 후보(top3)를 키워드 관련도로 재정렬해 2개(코사인 박빙 오선택 방지)
  const hinted = selectHintedArticles(normalized, q, tokens, opts?.vecHints) as { name: string; fullText: string }[];

  // 표 해석 예약: 키워드 상위(3위 이내)에 명제화된 기준표(대형 별표)가 있으면, 힌트·원칙 조문이
  // 예산을 선점해 통째 탈락하더라도 정답 '행 명제'만은 실리도록 예산 일부를 선확보.
  // (1위 한정이면 '전결' 같은 유의어가 원칙 조문(제N조) 이름과 다중 히트해 1위를 뺏는 순간 무력화된다)
  const glossTop = ranked.slice(0, 3).find((r) => r.score > 0 && r.a.tableGloss);
  const glossReserve = glossTop ? Math.min(560, Math.floor(maxLen * 0.4)) : 0;
  const budget = maxLen - glossReserve;

  const cap = Math.max(480, Math.floor(maxLen * 0.5)); // 조문당 캡: 최소 2개 조문이 예산에 공존
  const renderBlock = (a: { name: string; fullText: string; tableGloss?: string }): string => {
    const block = formatArticleBlock(a);
    let base = block;
    // 캡을 조금 넘는 조문(≤1.35배)은 자르지 않는다 — 594자 조문을 480자 창으로 깎으면
    // 히트 밀집부만 남고 정답 항(①의 "15일" 등)이 유실된다. 예산 검사는 tryPush가 그대로 수행.
    if (block.length > cap && block.length > Math.floor(cap * 1.35)) {
      const body = snippetAroundKeywordHits(a.fullText, tokens, Math.max(200, cap - a.name.length - 8));
      base = `${a.name}\n${body}`; // 창 발췌 — 히트가 조문 꼬리(신설 항)에 있어도 보존
    }
    // 표 해석(행 명제) 중 질의 히트 행 부착 — 평탄화된 표에서 창 발췌가 놓친 정답 행을 문장으로 보장.
    // 이미 발췌에 담긴 내용과는 dedupe(공백 무시)해 같은 정보의 이중 표기를 막는다.
    const bnorm = base.replace(/\s+/g, "");
    const glossLines = pickGlossLines(a.tableGloss, tokens).filter((l) => !bnorm.includes(l.replace(/\s+/g, "")));
    return glossLines.length ? `${base}\n〔표 해석〕\n${glossLines.join("\n")}` : base;
  };

  const seen = new Set<string>();
  const picked: string[] = [];
  let total = 0;
  const tryPush = (a: { name: string; fullText: string }): boolean => {
    if (seen.has(a.name)) return true;
    const block = renderBlock(a);
    const need = block.length + (picked.length ? 20 : 0);
    if (total + need > budget && picked.length > 0) return false;
    seen.add(a.name);
    picked.push(block);
    total += need;
    return total < budget * 0.9;
  };

  for (const a of hinted) if (!tryPush(a)) break;
  for (const { a, score } of ranked) {
    if (total >= budget * 0.9) break;
    if (score === 0 && picked.length > 0) break;
    if (score === 0 && picked.length === 0) continue;
    if (!tryPush(a)) break;
  }

  // 표 해석 구제 — 예약해 둔 기준표가 예산에서 통째 탈락한 경우, 질의 히트 명제 행만 부착
  if (glossReserve && glossTop && !seen.has(glossTop.a.name)) {
    const lines = pickGlossLines(glossTop.a.tableGloss, tokens, 4, glossReserve - glossTop.a.name.length - 24);
    if (lines.length) {
      picked.push(`${glossTop.a.name} 〔표 해석〕\n${lines.join("\n")}`);
      seen.add(glossTop.a.name);
    }
  }

  if (picked.length) {
    let out = picked.join("\n…\n");
    if (out.length > maxLen) {
      out = `${out.slice(0, maxLen - 20)}\n…[생략]…`;
    }
    return out;
  }

  let acc = "";
  for (const a of normalized) {
    const block = formatArticleBlock(a);
    if (!acc.length) {
      acc = block;
      if (acc.length >= maxLen) return `${acc.slice(0, maxLen - 20)}\n…[생략]…`;
      continue;
    }
    if (acc.length + block.length + 20 > maxLen) break;
    acc += `\n\n${block}`;
  }
  return acc || null;
}

/**
 * LLM용 스니펫: articles 가 있으면 조 단위로만 선택(통본 split 생략).
 * 없으면 통본 content + 「제 N 조」 분할 스니펫.
 */
export function buildRegulationSnippetForLlm(
  content: string,
  question: string,
  maxLen: number,
  articles?: { name: string; fullText?: string; order?: number; tableGloss?: string }[],
  vecHints?: ArticleVecHint[], // 임베딩 상위 조문(문서별) — 있으면 조문 선택에 의미신호로 반영
): string {
  const q = String(question || "").trim();
  const sem = semanticTermsForRag(q);
  const kw = extractKeywordsFromQuery(q);
  const merged = [...new Set([...sem, ...kw])].filter((t) => t.length >= 2);
  const semSet = new Set(sem);
  const tokens = merged.sort((a, b) => {
    const score = (x: string) =>
      (semSet.has(x) ? 2.5 : 1) * weightSnippetToken(x) * Math.min(x.length, 12);
    return score(b) - score(a);
  });
  const effectiveTokens = tokens.length ? tokens : extractKeywordsFromQuery(q);

  if (articles?.length) {
    const fromArticles = buildSnippetFromArticles(articles, effectiveTokens, maxLen, { q, vecHints });
    if (fromArticles) return fromArticles;
  }

  if (!tokens.length) {
    return snippetByJeSectionsAndHits(content, extractKeywordsFromQuery(q), maxLen);
  }
  return snippetByJeSectionsAndHits(content, tokens, maxLen);
}

function docKey(d: { _id?: unknown; title?: string; year?: string }): string {
  return d._id != null ? String(d._id) : `${d.title ?? ""}::${d.year ?? ""}`;
}

export type RagRegulationLean = {
  _id?: unknown;
  title?: string;
  content?: string;
  year?: string;
  category?: string;
  docNumber?: string;
  articles?: { name: string; fullText?: string; order?: number }[];
};

/**
 * $text + 키워드 RegExp 하이브리드 회수(참조 retrieveForQa, 사규 단일 컬렉션).
 */
export async function retrieveRagRegulationsForQa(question: string, maxDocs = 12): Promise<RagRegulationLean[]> {
  const q = String(question || "").trim();
  if (!q) return [];

  const searchTokens = retrievalSearchTokens(q);
  if (searchTokens.length === 0) return [];

  const scored = new Map<
    string,
    { doc: RagRegulationLean; textPart: number; regexPart: number; titleExtra: number }
  >();

  const bump = (d: RagRegulationLean, textPart: number, regexPart: number, titleExtra = 0) => {
    const k = docKey(d);
    const cur = scored.get(k);
    if (!cur) {
      scored.set(k, { doc: d, textPart, regexPart, titleExtra });
    } else {
      cur.textPart = Math.max(cur.textPart, textPart);
      cur.regexPart += regexPart;
      cur.titleExtra = Math.max(cur.titleExtra, titleExtra);
    }
  };

  const fullQ = buildMongoTextSearchQuery(q);
  if (fullQ.length >= 2) {
    try {
      const docs = await RagRegulationModel.find(
        { $text: { $search: fullQ }, ...RETRIEVAL_CORPUS_FILTER },
        { score: { $meta: "textScore" }, title: 1, content: 1, year: 1, category: 1, docNumber: 1, articles: 1 }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(22)
        .lean();
      for (const d of docs) {
        const meta = d as { score?: number };
        bump(d as RagRegulationLean, normalizeTextScore(meta.score), 0, 0);
      }
    } catch {
      /* $text 실패 시 RegExp만 */
    }
  }

  // PERF-001: 키워드별 RegExp 조회를 직렬 await(최대 8회 순차 왕복)하던 것을 병렬(Promise.all)로.
  // per-keyword limit(14)·스코어링 의미는 그대로 보존해 회수 품질(recall) 회귀 없이 지연만 sum→max로 단축.
  const kwRegexes = searchTokens.slice(0, 8).map((kw) => new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const kwBatches = await Promise.all(
    kwRegexes.map(async (regex) => {
      try {
        const batch = await RagRegulationModel.find({
          $or: [{ title: regex }, { content: regex }, { "articles.fullText": regex }, { "articles.name": regex }],
          ...RETRIEVAL_CORPUS_FILTER,
        })
          .select({ title: 1, content: 1, year: 1, category: 1, docNumber: 1, articles: 1 })
          .limit(14)
          .lean();
        return { regex, batch };
      } catch {
        return { regex, batch: [] as RagRegulationLean[] };
      }
    })
  );
  for (const { regex, batch } of kwBatches) {
    for (const d of batch) {
      const inTitle = regex.test((d as { title?: string }).title || "") ? 8 : 0;
      bump(d as RagRegulationLean, 0, 3 + inTitle, inTitle);
    }
  }

  const ranked = [...scored.values()]
    .map(({ doc, textPart, regexPart, titleExtra }) => ({
      doc,
      score: textPart + regexPart + titleExtra * 0.5,
    }))
    .sort((a, b) => b.score - a.score);

  return ranked.map(({ doc }) => doc).slice(0, maxDocs);
}

/** 하위 호환 별칭 */
export const retrieveInternalRegulationsForQa = retrieveRagRegulationsForQa;
