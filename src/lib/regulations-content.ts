/**
 * 파싱된 조문 → 참조 리포와 동일한 통본 `content` 문자열.
 */
export function buildRegulationContentFromArticles(
  title: string,
  year: string,
  articles: { name: string; fullText?: string }[]
): string {
  const head = year.trim() ? `${title} (${year.trim()})` : title;
  const parts: string[] = [head];
  for (const a of articles) {
    const body = (a.fullText ?? "").trim();
    parts.push(a.name ? `${a.name}\n${body}` : body);
  }
  return parts.join("\n\n");
}
