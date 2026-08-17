"use client";

import { useState } from "react";

/** 기간 선택값 — 최근 N일 프리셋 또는 직접 지정한 날짜 범위. */
export type Period =
  | { mode: "preset"; days: number }
  | { mode: "range"; from: string; to: string };

/** Period → 쿼리 파라미터 (days 또는 from/to). 범위가 불완전하면 days로 폴백. */
export function periodParams(p: Period): Record<string, string> {
  return p.mode === "range" && p.from && p.to
    ? { from: p.from, to: p.to }
    : { days: String(p.mode === "preset" ? p.days : 14) };
}

/** 사람이 읽는 라벨. */
export function periodLabel(p: Period): string {
  return p.mode === "range" && p.from && p.to
    ? `${p.from} ~ ${p.to}`
    : `최근 ${p.mode === "preset" ? p.days : 14}일`;
}

const chip = (active: boolean) =>
  `rounded-full px-2.5 py-1 text-xs font-semibold transition ${
    active
      ? "bg-[var(--ax-accent)] text-white"
      : "border border-[var(--ax-border)] bg-white text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]"
  }`;

export function PeriodPicker({
  value,
  onChange,
  presets,
}: {
  value: Period;
  onChange: (p: Period) => void;
  presets: number[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [showRange, setShowRange] = useState(value.mode === "range");
  const [from, setFrom] = useState(value.mode === "range" ? value.from : "");
  const [to, setTo] = useState(value.mode === "range" ? value.to : today);
  const [err, setErr] = useState("");

  const apply = () => {
    if (!from || !to) { setErr("시작·종료 날짜를 모두 선택하세요."); return; }
    if (from > to) { setErr("시작 날짜가 종료 날짜보다 늦습니다."); return; }
    setErr("");
    onChange({ mode: "range", from, to });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-bold text-[var(--ax-text-muted)]">기간</span>
        {presets.map((d) => (
          <button
            key={d}
            onClick={() => { setShowRange(false); onChange({ mode: "preset", days: d }); }}
            className={chip(!showRange && value.mode === "preset" && value.days === d)}
          >
            최근 {d}일
          </button>
        ))}
        <button onClick={() => setShowRange(true)} className={chip(showRange)}>
          기간 지정
        </button>
      </div>
      {showRange && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-[var(--ax-border)] px-2 py-1 text-sm text-[var(--ax-text)]" />
          <span className="text-[var(--ax-text-hint)]">~</span>
          <input type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-[var(--ax-border)] px-2 py-1 text-sm text-[var(--ax-text)]" />
          <button onClick={apply} className="rounded-lg bg-[var(--ax-accent)] px-3 py-1 text-xs font-bold text-white hover:opacity-90">적용</button>
          {err && <span className="text-xs text-[var(--ax-danger)]">{err}</span>}
        </div>
      )}
    </div>
  );
}
