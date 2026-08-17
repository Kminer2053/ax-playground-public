/** 별표류 원문 파서 — "○ 섹션" 분할 + 마크다운 표 블록 인식(위임전결 별표 제1호 등).
 *  순수 함수(클라이언트 안전). 섹션이 없으면 전문이 preamble 블록으로 온다. */

export type AnnexBlock = { type: "text"; lines: string[] } | { type: "table"; rows: string[][] };
export type AnnexSection = { title: string; blocks: AnnexBlock[]; hasQuote: boolean };
export type AnnexParsed = { preamble: AnnexBlock[]; sections: AnnexSection[]; matched: boolean };

const norm = (s: string) => s.replace(/\s+/g, "");

function isTableLine(l: string) {
  const t = l.trim();
  return t.startsWith("|") && t.endsWith("|");
}
function isSeparatorRow(cells: string[]) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
}
function splitRow(l: string): string[] {
  const t = l.trim();
  return t.slice(1, t.length - 1).split("|").map((c) => c.trim());
}

function linesToBlocks(lines: string[]): AnnexBlock[] {
  const blocks: AnnexBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableLine(lines[i])) {
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        const cells = splitRow(lines[i]);
        if (!isSeparatorRow(cells)) rows.push(cells);
        i += 1;
      }
      if (rows.length) blocks.push({ type: "table", rows });
    } else {
      const text: string[] = [];
      while (i < lines.length && !isTableLine(lines[i])) { text.push(lines[i]); i += 1; }
      // 앞뒤 빈 줄 정리
      while (text.length && !text[0].trim()) text.shift();
      while (text.length && !text[text.length - 1].trim()) text.pop();
      if (text.length) blocks.push({ type: "text", lines: text });
    }
  }
  return blocks;
}

export function parseAnnexSections(fullText: string, quote?: string): AnnexParsed {
  const lines = fullText.split("\n");
  const q = quote ? norm(quote) : "";
  const secStarts: number[] = [];
  lines.forEach((l, i) => { if (l.trim().startsWith("○")) secStarts.push(i); });

  if (secStarts.length < 2) {
    return { preamble: linesToBlocks(lines), sections: [], matched: false };
  }
  const preamble = linesToBlocks(lines.slice(0, secStarts[0]));
  const sections: AnnexSection[] = secStarts.map((start, k) => {
    const end = k + 1 < secStarts.length ? secStarts[k + 1] : lines.length;
    const body = lines.slice(start + 1, end);
    const hasQuote = !!q && norm(body.join("\n")).includes(q);
    return { title: lines[start].trim(), blocks: linesToBlocks(body), hasQuote };
  });
  return { preamble, sections, matched: sections.some((s) => s.hasQuote) };
}
