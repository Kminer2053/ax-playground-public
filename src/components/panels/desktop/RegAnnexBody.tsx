"use client";
/** 별표류 원문 본문 렌더 — 마크다운 표를 실제 표로, "○ 섹션"은 접이식.
 *  quote(근거 인용)가 속한 섹션만 기본 펼침(위임전결 별표 제1호의 부서별 전결 등),
 *  나머지는 제목만 접힘 + 전체 펼치기 토글. 다크(업무패널)·라이트(지식검색) 공용. */
import { useMemo, useState } from "react";
import { parseAnnexSections, type AnnexBlock } from "@/lib/reg-annex";

type Theme = "dark" | "light";
const T = {
  dark: {
    pre: "whitespace-pre-wrap break-words font-[inherit] text-[12.5px] leading-relaxed text-amber-100/85",
    table: "w-full border-collapse text-[12px] leading-snug",
    th: "border border-amber-200/20 bg-white/5 px-2 py-1 text-left font-bold text-amber-200/90",
    td: "border border-amber-200/15 px-2 py-1 text-amber-100/85",
    secBtn: "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-bold text-amber-200 hover:bg-white/5",
    secBadge: "rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300",
    toggle: "rounded-lg border border-amber-200/25 px-2.5 py-1 text-[11px] font-bold text-amber-200/90 hover:bg-white/5",
    chev: "text-amber-200/50",
  },
  light: {
    pre: "whitespace-pre-wrap break-words font-[inherit] text-[12.5px] leading-relaxed text-[var(--ax-text)]/85",
    table: "w-full border-collapse text-[12px] leading-snug",
    th: "border border-[var(--ax-border)] bg-black/5 px-2 py-1 text-left font-bold text-[var(--ax-text)]",
    td: "border border-[var(--ax-border)] px-2 py-1 text-[var(--ax-text)]/85",
    secBtn: "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-bold text-[var(--ax-accent)] hover:bg-[var(--ax-border-soft)]",
    secBadge: "rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800",
    toggle: "rounded-lg border border-[var(--ax-border)] px-2.5 py-1 text-[11px] font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]",
    chev: "text-[var(--ax-text-hint)]",
  },
} as const;

function Block({ b, t }: { b: AnnexBlock; t: (typeof T)[Theme] }) {
  if (b.type === "text") return <pre className={t.pre}>{b.lines.join("\n")}</pre>;
  const [head, ...body] = b.rows;
  return (
    <div className="my-2 overflow-x-auto">
      <table className={t.table}>
        {head && (
          <thead>
            <tr>{head.map((c, i) => <th key={i} className={t.th}>{c}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`${t.td} ${c === "●" ? "text-center" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RegAnnexBody({ fullText, quote, theme }: { fullText: string; quote?: string; theme: Theme }) {
  const t = T[theme];
  const parsed = useMemo(() => parseAnnexSections(fullText, quote), [fullText, quote]);
  const [openAll, setOpenAll] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  if (!parsed.sections.length) {
    return <>{parsed.preamble.map((b, i) => <Block key={i} b={b} t={t} />)}</>;
  }
  // 인용 매칭이 없으면 전부 펼침(일반 열람)
  const defaultOpen = (i: number) => (parsed.matched ? parsed.sections[i].hasQuote : true);
  const isOpen = (i: number) => openAll || (open[i] ?? defaultOpen(i));

  return (
    <div>
      {parsed.matched && (
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={() => setOpenAll((v) => !v)} className={t.toggle}>
            {openAll ? "관련 부분만 보기" : "별표 전체 펼치기"}
          </button>
        </div>
      )}
      {parsed.preamble.map((b, i) => <Block key={`p${i}`} b={b} t={t} />)}
      {parsed.sections.map((s, i) => (
        <section key={i} className="mt-1.5">
          <button type="button" className={t.secBtn} onClick={() => setOpen((o) => ({ ...o, [i]: !isOpen(i) }))}>
            <span className={t.chev}>{isOpen(i) ? "▾" : "▸"}</span>
            <span className="min-w-0 flex-1">{s.title}</span>
            {s.hasQuote && <span className={t.secBadge}>근거 위치</span>}
          </button>
          {isOpen(i) && <div className="pl-1">{s.blocks.map((b, j) => <Block key={j} b={b} t={t} />)}</div>}
        </section>
      ))}
    </div>
  );
}
