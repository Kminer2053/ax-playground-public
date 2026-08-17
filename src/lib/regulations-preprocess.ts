/**
 * PDF/스캔 TXT 변환본 잡음 제거 — 조 추출·임베딩 품질 향상
 */

/** 본문 영역에서 페이지 마커·바닥글·연속 개정 이력(앞부분) 등을 정리 */
export function preprocessRegulationBody(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n");
  s = s.replace(/---\s*\d+\s*페이지\s*---/gi, "\n");
  s = s.replace(/^\s*-\s*\d+\s*-\s*$/gm, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = stripLeadingRevisionNoise(s);
  return s.trim();
}

/** 첫 `제 N 장|절|조` 전까지, 개정·제정만 반복되는 머리줄 제거(표지·개정 이력 표) */
function stripLeadingRevisionNoise(s: string): string {
  const lines = s.split("\n");
  const start = lines.findIndex((l) => {
    const t = l.trim();
    if (!t) return false;
    return /^제\s*\d+\s*(장|절|조)/.test(t);
  });
  if (start > 0) {
    return lines.slice(start).join("\n").trim();
  }
  return s.trim();
}
