import { RagRegulationModel } from "@/models/RagRegulation";
import { resolveRegulationTitle, normTitle, bigramSim } from "@/lib/regulations-alias";

/**
 * 추출형 직행 경로 — "○○규정 제N조" 류의 조문 조회형 질문은 LLM 없이 조문 원문+출처를
 * 결정적으로 반환한다(내부 감사: 원샷 조립 1~2ms, 조문 2,805건 커버). gemma 50초/호출과
 * 환각·오귀속 위험을 경로 자체에서 제거하는 것이 목적. 판정이 애매하면 null(기존 검색 경로).
 */

export type ExtractiveResult = {
  answer: string;
  references: { title?: string; revisionInfo: string; id?: string; category: "regulation" }[];
  citations: { id: string; title?: string; category: "regulation"; year: string; articles: string[] }[];
} | null;

/** 추출형 판정의 전체 결과 — result가 null이어도 '다중 후보'였다면 그 제목들을 검색 시드로 넘긴다(버리지 않음). */
export type ExtractiveOutcome = { result: ExtractiveResult; seedTitles: string[] };

const BODY_CAP = 2000; // 조문형 p99=1,603자(감사 실측) — 별표 꼬리 방어 상한

// 조회 의도만 남는지 검사 — 해석·적용을 묻는 어미가 있으면 추출형이 아니라 검색·LLM 경로가 맞다.
const LOOKUP_TAIL = /^[\s,.·]*(?:의?\s*(?:내용|전문|원문|조문|규정)?\s*(?:이?\s*뭐(?:야|예요|에요)?|무엇\w*|알려\s*줘?요?|보여\s*줘?요?|확인(?:해\s*줘?요?)?|찾아\s*줘?요?|좀|주세요|해줘)?)?[\s?.!~]*$/;
const INTERPRETIVE = /어떻게|왜|언제|얼마|누가|해야|되나|할\s*수|가능|절차|방법|기준|따라|적용|위반|차이|비교/;

export type ArticleLookup = { namePart: string; jo: number; ui: number | null };

/** 질문에서 (규정명, 제N조[의M]) 조회 패턴을 추출. 조회 의도가 아니면 null. */
export function parseArticleLookup(question: string): ArticleLookup | null {
  const q = (question ?? "").trim();
  if (!q || q.length > 60) return null; // 장문은 해석형 — 안전측
  const m = q.match(/^\s*「?([가-힣A-Za-z0-9·()\s]{2,30}?)」?\s*(?:의|상)?\s*제\s*(\d{1,3})\s*조(?:\s*의\s*(\d{1,2}))?/);
  if (!m) return null;
  const tail = q.slice((m.index ?? 0) + m[0].length);
  if (INTERPRETIVE.test(q) || !LOOKUP_TAIL.test(tail)) return null; // 해석 요구 → 검색 경로
  const namePart = m[1].trim();
  if (namePart.length < 2) return null;
  return { namePart, jo: parseInt(m[2], 10), ui: m[3] ? parseInt(m[3], 10) : null };
}

/** 조문 조회형이면 원문 답변을 조립, 아니면 null(기존 경로 진행). */
export async function buildExtractiveAnswer(question: string): Promise<ExtractiveResult> {
  return (await buildExtractiveOutcome(question)).result;
}

/** 추출형 판정 + 다중 후보 시드 — 조회형인데 규정명이 모호하면 후보 제목을 검색 시드로 반환. */
export async function buildExtractiveOutcome(question: string): Promise<ExtractiveOutcome> {
  const lk = parseArticleLookup(question);
  if (!lk) return { result: null, seedTitles: [] };

  const r = await resolveRegulationTitle(lk.namePart);
  if (!r.title) return { result: null, seedTitles: r.candidates.slice(0, 3) }; // 모호 → 검색 경로 + 후보를 시드로(오라우팅 방지·회수 절약)

  const doc = (await RagRegulationModel.findOne({ title: r.title })
    .select({ title: 1, year: 1, category: 1, docNumber: 1, articles: 1 })
    .lean()) as {
    _id?: unknown; title?: string; year?: string; category?: string; docNumber?: string;
    articles?: { name?: string; fullText?: string }[];
  } | null;
  if (!doc?.articles?.length) return { result: null, seedTitles: r.title ? [r.title] : [] };

  const joRe = lk.ui != null
    ? new RegExp(`^제\\s*${lk.jo}\\s*조\\s*의\\s*${lk.ui}(?!\\d)`)
    : new RegExp(`^제\\s*${lk.jo}\\s*조(?!의)(?!\\d)`);
  let arts = doc.articles.filter((a) => joRe.test((a.name ?? "").trim()));
  if (!arts.length) {
    // 조문 부재도 '결정적 없음'으로 답한다 — 검색 경로로 흘리면 무관 조문 억지 인용 위험(안전측 명시 응답).
    const meta = [doc.category, doc.docNumber].filter(Boolean).join(" ");
    return { result: {
      answer:
        `「${doc.title}」에는 제${lk.jo}조${lk.ui != null ? `의${lk.ui}` : ""}가 없습니다.\n\n` +
        `- 확인 범위: 「${doc.title}」${meta ? ` (${meta})` : ""} 전체 조문 (현행 적재본 기준)\n` +
        `- 조문 번호를 다시 확인하시거나, 질문 내용을 키워드로 검색해 보세요.`,
      references: [{ title: doc.title, revisionInfo: doc.year ?? "", id: doc._id != null ? String(doc._id) : undefined, category: "regulation" }],
      citations: [],
    }, seedTitles: [] };
  }
  if (arts.length > 1) {
    const alive = arts.filter((a) => !/\(\s*삭\s*제\s*\)/.test(a.name ?? ""));
    if (alive.length) arts = alive; // 동번호 공존(예: 제46조 신·구) 시 삭제분 제외
    arts = arts.slice(0, 2);
  }

  const meta = [doc.category, doc.docNumber].filter(Boolean).join(" ");
  const eff = doc.year ? ` · 시행 ${doc.year}` : "";
  const blocks = arts.map((a) => {
    const body = (a.fullText ?? "").trim();
    const cut = body.length > BODY_CAP ? body.slice(0, BODY_CAP) + "\n\n…(이하 생략 — 조문이 깁니다. 원문 전체는 사규 원문에서 확인하세요)" : body;
    return `### ${a.name}\n\n${cut || "(본문 없음)"}`;
  });

  const answer =
    `**「${doc.title}」${meta ? ` (${meta}${eff})` : eff}** — 조문 원문입니다(AI 생성문 아님).\n\n` +
    blocks.join("\n\n") +
    `\n\n---\n*사규 원문을 그대로 표시했습니다. 해석·적용이 필요하면 질문을 문장으로 바꿔 다시 검색해 주세요.*`;

  return { result: {
    answer,
    references: [{ title: doc.title, revisionInfo: doc.year ?? "", id: doc._id != null ? String(doc._id) : undefined, category: "regulation" }],
    citations: [{
      id: doc._id != null ? String(doc._id) : "",
      title: doc.title,
      category: "regulation",
      year: doc.year ?? "",
      articles: arts.map((a) => a.name).filter((n): n is string => !!n),
    }],
  }, seedTitles: [] };
}

/** 시드 제목들의 문서를 회수 형태로 로드 — 추출형 다중 후보를 검색 경로의 선두 시드로 넘길 때 사용. */
/** 인용게이트 재회수 — 답변이 인용했지만 근거셋에 없는 규정명을 DB 실제 사규 제목으로 해석.
 *  정규화 일치 우선, 아니면 바이그램 0.75↑ 유일 매치만(과잉 관용 방지 — cite-gate matchHit와 동일 기준).
 *  법령·행정규칙 제외(검색 격리 — 지식검색 근거는 사규만). 해석 실패는 환각으로 보고 기존 교정 경로에 맡긴다. */
export async function resolveCitedTitles(cited: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!cited.length) return out;
  const rows = (await RagRegulationModel.find({ category: { $nin: ["법령", "행정규칙"] } }).select({ title: 1 }).lean()) as { title?: string }[];
  const titles = rows.map((r) => String(r.title || "")).filter(Boolean);
  const byNorm = new Map(titles.map((t) => [normTitle(t), t]));
  for (const c of cited) {
    const exact = byNorm.get(normTitle(c));
    if (exact) { out.set(c, exact); continue; }
    const scored = titles.map((t) => ({ t, s: bigramSim(c, t) })).sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= 0.75 && (!scored[1] || scored[0].s - scored[1].s >= 0.1)) out.set(c, scored[0].t);
  }
  return out;
}

export async function fetchSeedDocsByTitles(titles: string[]): Promise<
  { _id?: unknown; title?: string; content?: string; year?: string; category?: string; docNumber?: string;
    articles?: { name: string; fullText?: string; order?: number }[] }[]
> {
  if (!titles.length) return [];
  return (await RagRegulationModel.find({ title: { $in: titles } })
    .select({ title: 1, content: 1, year: 1, category: 1, docNumber: 1, articles: 1 })
    .lean()) as never;
}
