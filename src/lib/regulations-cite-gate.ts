import { normTitle, bigramSim } from "@/lib/regulations-alias";

/**
 * 결정적 인용 게이트 — 답변이 인용한 「규정명」·제N조가 실제 근거 문서(검색셋)에 존재하는지
 * 코드로 대조한다(LLM 판단 없음). 키는 (문서명, 조문명) — (doc,ci)는 재적재 시 재부여되므로 금지(감사 R10).
 * 외부 법령(…법·시행령 등)은 사규가 아니므로 대조 대상에서 제외.
 */

export type CiteCheck = {
  checked: boolean;
  citedTitles: string[];       // 답변이 인용한 사규 제목(정규화 전 원문 표기)
  unknownTitles: string[];     // 근거 문서에 없는 규정명 인용(환각/근거밖)
  wrongArticles: string[];     // 규정은 근거에 있으나 그 조문이 없는 인용("「A」 제N조")
};

type HitLike = { title?: string; articles?: { name?: string }[] };

const LAW_SUFFIX = /(법|법률|시행령|시행규칙|조례|고시|훈령|헌법)$/;

/** 질문에서 사용자가 쓴 「…」 토큰 — 답변이 되받아 쓴 것은 규정 인용이 아니다(업무100 프리필 등). */
function quotedInQuestion(question?: string): Set<string> {
  const s = new Set<string>();
  if (!question) return s;
  for (const m of question.matchAll(/「([^」\n]{2,40})」/g)) s.add(normTitle(m[1].trim()));
  return s;
}

/** 답변에서 「…」 인용과 바로 뒤따르는 제N조[의M] 표기를 추출.
 *  question을 주면 ⑴질문이 인용한 토큰과 ⑵「X」 업무/업무의… 처럼 규정명이 아닌 지칭을 제외한다. */
export function extractCitations(answer: string, question?: string): { title: string; jos: { jo: number; ui: number | null }[] }[] {
  const out = new Map<string, Set<string>>();
  const echoed = quotedInQuestion(question);
  const re = /「([^」\n]{2,40})」((?:[^「\n]{0,40}?제\s*\d{1,3}\s*조(?:\s*의\s*\d{1,2})?)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer))) {
    const title = m[1].trim();
    if (!title || LAW_SUFFIX.test(normTitle(title))) continue; // 외부 법령 제외
    if (echoed.has(normTitle(title))) continue;                // 질문 되받기(업무명 등)
    // 「X」 바로 뒤가 "업무"면 규정명이 아니라 업무 지칭 — 대조 대상 아님
    const after = answer.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (/^\s*업무/.test(after)) continue;
    if (!out.has(title)) out.set(title, new Set());
    const tail = m[2] ?? "";
    const joRe = /제\s*(\d{1,3})\s*조(?:\s*의\s*(\d{1,2}))?/g;
    let jm: RegExpExecArray | null;
    while ((jm = joRe.exec(tail))) out.get(title)!.add(`${jm[1]}:${jm[2] ?? ""}`);
  }
  return [...out.entries()].map(([title, set]) => ({
    title,
    jos: [...set].map((s) => { const [a, b] = s.split(":"); return { jo: parseInt(a, 10), ui: b ? parseInt(b, 10) : null }; }),
  }));
}

function matchHit(title: string, hits: HitLike[]): HitLike | null {
  const n = normTitle(title);
  for (const h of hits) if (h.title && normTitle(h.title) === n) return h;
  // 표기 요동(조사·부분 표기) 보정 — 바이그램 0.75 이상 유일 매치만 허용(과잉 관용 방지)
  const scored = hits
    .filter((h) => !!h.title)
    .map((h) => ({ h, s: bigramSim(title, h.title!) }))
    .sort((a, b) => b.s - a.s);
  if (scored[0] && scored[0].s >= 0.75 && (!scored[1] || scored[0].s - scored[1].s >= 0.1)) return scored[0].h;
  return null;
}

function hasArticle(hit: HitLike, jo: number, ui: number | null): boolean {
  const list = hit.articles ?? [];
  const re = ui != null
    ? new RegExp(`^제\\s*${jo}\\s*조\\s*의\\s*${ui}(?!\\d)`)
    : new RegExp(`^제\\s*${jo}\\s*조(?!의)(?!\\d)`);
  return list.some((a) => re.test((a.name ?? "").trim()));
}

/** 답변 인용을 근거 문서셋과 대조. 위반이 있으면 재생성 지시문/경고 각주 생성에 사용.
 *  question을 함께 주면 질문 되받기(「업무명」)로 인한 허위 경고를 막는다. */
export function verifyCitations(answer: string, hits: HitLike[], question?: string): CiteCheck {
  const cites = extractCitations(answer, question);
  const unknownTitles: string[] = [];
  const wrongArticles: string[] = [];
  for (const c of cites) {
    const hit = matchHit(c.title, hits);
    if (!hit) { unknownTitles.push(c.title); continue; }
    for (const j of c.jos) {
      // articles가 로드 안 된 힛(발췌 전용)은 조문 판정 불가 → 건너뜀(허위 양성 방지)
      if (!hit.articles?.length) continue;
      if (!hasArticle(hit, j.jo, j.ui)) wrongArticles.push(`「${hit.title}」 제${j.jo}조${j.ui != null ? `의${j.ui}` : ""}`);
    }
  }
  return { checked: true, citedTitles: cites.map((c) => c.title), unknownTitles: [...new Set(unknownTitles)], wrongArticles: [...new Set(wrongArticles)] };
}

/** 위반 시 1회 재생성용 교정 지시문. */
export function buildCorrection(check: CiteCheck): string {
  const parts: string[] = [];
  if (check.unknownTitles.length) parts.push(`다음 규정명은 제공된 근거 문서에 없습니다(인용 금지): ${check.unknownTitles.map((t) => `「${t}」`).join(", ")}`);
  if (check.wrongArticles.length) parts.push(`다음 조문은 해당 규정에 존재하지 않습니다(인용 금지): ${check.wrongArticles.join(", ")}`);
  return `[인용 오류 교정] ${parts.join(" / ")}. 반드시 제공된 근거 문서에 실제로 있는 규정명·조문만 인용해 답변을 다시 작성하세요. 근거가 없으면 "제공된 자료에서 확인되지 않습니다"라고 밝히세요.`;
}

/** 재생성 후에도 남은 위반 → 정직한 경고 각주(삭제 대신 표시 — 문장 절단 방지). */
export function buildWarnFooter(check: CiteCheck): string {
  const items: string[] = [];
  if (check.unknownTitles.length) items.push(`근거 문서에서 확인되지 않은 규정명: ${check.unknownTitles.map((t) => `「${t}」`).join(", ")}`);
  if (check.wrongArticles.length) items.push(`해당 규정에서 확인되지 않은 조문: ${check.wrongArticles.join(", ")}`);
  if (!items.length) return "";
  return `\n\n---\n⚠️ **인용 확인 안내** — ${items.join(" · ")}. 위 인용은 검색된 근거와 대조되지 않았으니 원문 확인 후 활용하세요.`;
}
