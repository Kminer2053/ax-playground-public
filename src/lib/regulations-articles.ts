/**
 * 사규 통본 본문을 「제 N 조」 단위로 분할·저장할 때 사용.
 * regulations-retrieve 의 JE_SPLIT 과 동일 규칙 유지.
 */

/** "제1조(목적)", "제 3 조의2(...)" 등 줄 시작 패턴 */
export const JE_SPLIT = /(?=\n\s*제\s*\d+\s*조(?:의?\s*\d+)?\s*[\(（])/g;

export type RagArticleInput = {
  name: string;
  fullText: string;
  order: number;
};

const ARTICLE_HEAD = /^제\s*\d+\s*조(?:의?\s*\d+)?\s*[\(（]/;

/**
 * 통본 content → 조문 배열 (DB 적재·마이그레이션용).
 * 제목/머리글만 있는 청크는 건너뜀.
 */
export function splitContentIntoArticles(content: string): RagArticleInput[] {
  const text = String(content ?? "").trim();
  if (!text.length) return [];

  const sections = text.split(JE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const out: RagArticleInput[] = [];
  let order = 0;

  for (const chunk of sections) {
    const nl = chunk.indexOf("\n");
    const firstLine = (nl >= 0 ? chunk.slice(0, nl) : chunk).trim();
    if (!ARTICLE_HEAD.test(firstLine)) continue;
    const fullText = nl >= 0 ? chunk.slice(nl + 1).trim() : "";
    out.push({ name: firstLine, fullText, order: order++ });
  }

  return out;
}
