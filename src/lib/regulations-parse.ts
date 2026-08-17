/**
 * 사규 TXT 공통 파서 — [문서명] … 제 N 조(…) … 본문
 */
import { preprocessRegulationBody } from "./regulations-preprocess";

export type ParsedRegulationFile = {
  title: string;
  revisionInfo: string;
  articles: { name: string; fullText: string }[];
};

export function parseDocumentName(line: string): { title: string; revisionInfo: string } | null {
  const m = line.match(/\[문서명\]\s*(.+)/);
  if (!m) return null;
  const full = m[1].trim().replace(/\s*\(\d+\)\s*$/, "");
  const revMatch = full.match(/\s*\(\s*([^)]*(?:개정|제정)[^)]*)\s*\)\s*$/);
  if (revMatch) {
    const title = full.slice(0, full.length - revMatch[0].length).trim();
    return { title, revisionInfo: revMatch[1].trim() };
  }
  return { title: full, revisionInfo: "" };
}

export function extractArticles(content: string): { name: string; fullText: string }[] {
  const cleaned = preprocessRegulationBody(content);
  const articles: { name: string; fullText: string }[] = [];
  const articleBlock = /제\s*(\d+)\s*조\s*\(\s*([^)]+)\s*\)\s*/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  let lastName: string | null = null;
  while ((m = articleBlock.exec(cleaned)) !== null) {
    if (lastName !== null) {
      const fullText = cleaned.slice(lastEnd, m.index).trim();
      articles.push({ name: lastName, fullText: fullText.slice(0, 10000) });
    }
    lastName = `제${m[1]}조(${m[2].trim()})`;
    lastEnd = m.index + m[0].length;
  }
  if (lastName !== null) {
    const fullText = cleaned.slice(lastEnd).trim();
    articles.push({ name: lastName, fullText: fullText.slice(0, 10000) });
  }
  return articles;
}

export function parseTxtFileRaw(raw: string): ParsedRegulationFile | null {
  const lines = raw.split(/\r?\n/);
  const first = lines.find((l) => l.startsWith("[문서명]"));
  if (!first) return null;
  const doc = parseDocumentName(first);
  if (!doc) return null;
  const sep = raw.indexOf("============================================================");
  const content = sep >= 0 ? raw.slice(sep) : raw;
  const articles = extractArticles(content);
  return articles.length > 0 ? { title: doc.title, revisionInfo: doc.revisionInfo, articles } : null;
}
