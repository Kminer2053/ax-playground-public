"use client";

/**
 * 낱말 단위 인라인 diff — 추가=초록, 삭제=빨강 취소선. 한글은 음절 단위로 세밀하게.
 * 사규 적재(구↔신 조문)와 근거 재검토(격리 시점 인용↔현재 원문)가 함께 쓴다.
 */

// ── 조문 열람 시 구↔신 낱말 단위 diff(추가=초록, 삭제=빨강 취소선). 한글은 음절 단위로 세밀하게. ──
function tokenizeForDiff(s: string): string[] {
  return s.match(/\s+|[A-Za-z0-9]+|[가-힣]|[^\s]/g) || [];
}
type DiffOp = { op: "eq" | "del" | "ins"; t: string };
function diffTokens(a0: string[], b0: string[]): DiffOp[] {
  let a = a0, b = b0, n = a.length, m = b.length;
  if ((n + 1) * (m + 1) > 4_000_000) { // 비용 가드: 과대하면 줄 단위로 축소, 그래도 크면 통째 교체로 표기
    const al = a.join("").split(/(?<=\n)/), bl = b.join("").split(/(?<=\n)/);
    if ((al.length + 1) * (bl.length + 1) <= 4_000_000) { a = al; b = bl; n = a.length; m = b.length; }
    else return [{ op: "del", t: a.join("") }, { op: "ins", t: b.join("") }];
  }
  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W); // LCS 길이 DP(뒤→앞)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + (j + 1)] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + (j + 1)]);
  const out: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: "eq", t: a[i] }); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + (j + 1)]) { out.push({ op: "del", t: a[i] }); i++; }
    else { out.push({ op: "ins", t: b[j] }); j++; }
  }
  while (i < n) out.push({ op: "del", t: a[i++] });
  while (j < m) out.push({ op: "ins", t: b[j++] });
  return out;
}
export function InlineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const groups: DiffOp[] = [];
  for (const o of diffTokens(tokenizeForDiff(oldText), tokenizeForDiff(newText))) {
    const last = groups[groups.length - 1];
    if (last && last.op === o.op) last.t += o.t; else groups.push({ ...o });
  }
  return (
    <pre className="whitespace-pre-wrap leading-relaxed text-[var(--ax-text-muted)]">
      {groups.map((g, k) =>
        g.op === "eq" ? <span key={k}>{g.t}</span>
          : g.op === "del" ? <span key={k} className="bg-[#fee2e2] text-[#b91c1c] line-through">{g.t}</span>
            : <span key={k} className="bg-[#dcfce7] text-[#166534]">{g.t}</span>,
      )}
    </pre>
  );
}
