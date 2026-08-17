"use client";

import { useEffect, useState } from "react";

/** 업무사이트 엑셀 다운로드 가이드 오버레이 — ① 업종별 / ② 전문점 탭(이미지). */
const TABS = [
  { n: 1, label: "① 업종별 매출실적", img: "/market/guide-overview.jpg", sub: "사내 매출시스템의 업종별 매출실적 메뉴(예: 영업관리 › 매출조회)에서 일/월/년 엑셀을 받는 방법 (전체·역별 분석용)" },
  { n: 2, label: "② 전문점 세부분류", img: "/market/guide-jeonmun.jpg", sub: "사내 매출시스템의 매출분석 메뉴(예: 영업관리 › 매출조회)에서 전문점 일자별·월별 엑셀을 받는 방법" },
];

export function GuideOverlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState(1);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  const cur = TABS.find((t) => t.n === tab) ?? TABS[0];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 border-b border-[var(--ax-border)] px-5 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--ax-text)]"><span className="material-symbols-outlined text-[20px] text-[var(--ax-accent)]">download</span>파일 다운로드 가이드</div>
            <div className="mt-0.5 text-[11px] text-[var(--ax-text-hint)]">{cur.sub}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[var(--ax-text-hint)] hover:bg-[var(--ax-border-soft)]"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="flex gap-1 border-b border-[var(--ax-border)] px-5 pt-2">
          {TABS.map((t) => (
            <button key={t.n} type="button" onClick={() => setTab(t.n)} className={`border-b-2 px-3 py-2 text-sm font-bold transition ${tab === t.n ? "border-[var(--ax-accent)] text-[var(--ax-accent)]" : "border-transparent text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]"}`}>{t.label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--ax-border-soft)] p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cur.img} alt={`${cur.label} 다운로드 가이드`} className="mx-auto w-full max-w-3xl rounded-lg border border-[var(--ax-border)] bg-white" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ax-border)] px-5 py-2.5">
          <span className="text-[11px] text-[var(--ax-text-hint)]">필터 없이 전체(9개 본부·13개 센터)를 받아 업로드해 주세요. 더 긴 기간은 여러 번 받아 합산됩니다.</span>
          <a href={cur.img} target="_blank" rel="noreferrer" className="rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] px-3 py-1.5 text-xs font-bold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">새 창에서 크게 보기</a>
        </div>
      </div>
    </div>
  );
}
