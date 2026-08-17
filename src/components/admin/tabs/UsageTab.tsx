"use client";

import { useCallback, useEffect, useState } from "react";
import { PeriodPicker, periodParams, periodLabel, type Period } from "@/components/admin/PeriodPicker";
import { csvCell } from "@/lib/csv";

type FeatureAgg = { feature: string; enter: number; use: number };
type DayRow = { day: string; visit: number; enter: number; use: number };
type Summary = {
  days: number;
  total: number;
  visits: number;
  entersTotal: number;
  byFeature: FeatureAgg[];
  detail: { feature: string; action: string; count: number }[];
  byDay: DayRow[];
};

const FEATURE_LABEL: Record<string, string> = {
  quiz: "AI 리터러시 퀴즈",
  library: "AX 라이브러리",
  knowledge: "AI 지식검색",
  sales: "AI 매출분석",
  docs: "AI 문서작성",
  safety: "스마트 안전관리",
  cs: "AI 민원답변",
  ad: "AI 광고도안심의",
  magazine: "AI 리서치매거진",
};
const ALL_FEATURES = Object.keys(FEATURE_LABEL);

/** 실행 세부 action 라벨. 문서작성(생성/챗/첨부)·라이브러리(열람/게시) 등 세분 표시용. */
const ACTION_LABEL: Record<string, string> = {
  use: "실행",
  generate: "문서 생성",
  chat: "사이드챗",
  attach: "첨부분석",
  post: "게시",
  view: "열람",
  download: "다운로드",
  // 기능별 실행 유형(2026-08-04 세분화) — 이전 기록은 "use"(실행)로 남아 있다
  source: "출처 확인",
  graph: "그래프 열람",
  work: "업무 상세",
  board: "업무흐름도",
  workdoc: "업무근거 원문",
  parse: "원본 분석",
  refine: "내용 수정",
  vote: "추천",
  trend: "추이 질의",
  diagnosis: "매장 진단",
  standard: "표준 어조",
  empathy: "공감 어조",
  concise: "간결 어조",
  review: "심의 완료",
  complete: "완주",
  // 지식검색 경로별(2026-07-20 세분화)
  fast: "빠른검색",
  deep: "심층검색",
  extractive: "조문 직행",
  refused: "게이트 거절",
  empty: "근거없음",
  search: "사규 목록검색",
  // 안전
  image: "이미지 분석",
  qa: "안전 QA",
  // 공통
  blocked: "차단",
};

/** 일별 추이 계열 — 접속/진입/실행 중 선택해서 본다. */
const SERIES = [
  { key: "visit", label: "접속", color: "var(--ax-accent)" },
  { key: "enter", label: "진입", color: "var(--ax-text-muted)" },
  { key: "use", label: "실행", color: "var(--ax-success)" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

function StatCard({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: "accent" | "muted" | "success" }) {
  const color = tone === "accent" ? "var(--ax-accent)" : tone === "success" ? "var(--ax-success)" : "var(--ax-text-muted)";
  return (
    <div className="rounded-2xl border border-[var(--ax-border)] bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold text-[var(--ax-text-muted)]">{label}</div>
      <div className="mt-1 text-3xl font-black tabular-nums" style={{ color }}>{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[11px] text-[var(--ax-text-hint)]">{hint}</div>
    </div>
  );
}

export function UsageTab() {
  const [period, setPeriod] = useState<Period>({ mode: "preset", days: 14 });
  const [sel, setSel] = useState<Set<string>>(new Set(ALL_FEATURES));
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<SeriesKey>("use"); // 일별 추이에 표시할 계열

  const load = useCallback(async () => {
    if (sel.size === 0) { setData({ days: 0, total: 0, visits: 0, entersTotal: 0, byFeature: [], detail: [], byDay: [] }); setLoading(false); return; }
    setLoading(true);
    try {
      const qs = new URLSearchParams(periodParams(period));
      if (sel.size < ALL_FEATURES.length) qs.set("features", [...sel].join(","));
      const d = await fetch(`/api/admin/usage?${qs.toString()}`).then((r) => r.json());
      setData(d.ok ? d : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, sel]);
  useEffect(() => { void load(); }, [load]);

  const toggle = (f: string) => setSel((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const allOn = sel.size === ALL_FEATURES.length;

  const maxUse = Math.max(1, ...(data?.byFeature ?? []).map((f) => f.use));
  const cur = SERIES.find((s) => s.key === series) ?? SERIES[2];
  const maxD = Math.max(1, ...(data?.byDay ?? []).map((d) => d[series]));
  const seriesTotal = (data?.byDay ?? []).reduce((s, d) => s + d[series], 0);

  // 실행 세부(action) 기능별 그룹 — 다중 action 기능만(문서작성·라이브러리 등).
  const detailByFeature = new Map<string, { action: string; count: number }[]>();
  for (const d of data?.detail ?? []) {
    const arr = detailByFeature.get(d.feature) ?? [];
    arr.push({ action: d.action, count: d.count });
    detailByFeature.set(d.feature, arr);
  }
  // 유형이 하나뿐이어도 그것이 무엇인지는 보여준다 — 기능별 막대는 합계만 알려주기 때문이다.
  const multiActionFeatures = [...detailByFeature.entries()].filter(([, arr]) => arr.length > 0);

  const exportCsv = () => {
    if (!data) return;
    const cell = csvCell;
    const lines: string[] = [];
    lines.push("AX Playground 사용통계");
    lines.push(["기간", periodLabel(period)].map(cell).join(","));
    lines.push(["기능 필터", allOn ? "전체" : [...sel].map((f) => FEATURE_LABEL[f] ?? f).join(" · ")].map(cell).join(","));
    lines.push(["사이트 접속(방문)", `${data.visits}회`].map(cell).join(","));
    lines.push(["패널 진입 합", `${data.entersTotal}회`].map(cell).join(","));
    lines.push(["주요기능 실행 합", `${data.total}회`].map(cell).join(","));
    lines.push("");
    lines.push("[기능별 진입·실행]");
    lines.push("기능,진입,실행");
    for (const f of data.byFeature) lines.push([FEATURE_LABEL[f.feature] ?? f.feature, f.enter, f.use].map(cell).join(","));
    lines.push("");
    lines.push("[실행 세부(유형)]");
    lines.push("기능,유형,횟수");
    for (const d of data.detail) lines.push([FEATURE_LABEL[d.feature] ?? d.feature, ACTION_LABEL[d.action] ?? d.action, d.count].map(cell).join(","));
    lines.push("");
    lines.push("[일별 추이]");
    lines.push("일자,접속,진입,실행");
    for (const d of data.byDay) lines.push([d.day, d.visit, d.enter, d.use].map(cell).join(","));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `usage_${period.mode === "range" ? `${period.from}_${period.to}` : `recent${period.days}d`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasData = !!data && (data.visits > 0 || data.entersTotal > 0 || data.total > 0);

  return (
    <div className="space-y-5">
      {/* 필터바 */}
      <div className="space-y-2 rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-white p-3 shadow-sm">
        <PeriodPicker value={period} onChange={setPeriod} presets={[1, 7, 14, 30, 90]} />
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ax-border-soft)] pt-2">
          <span className="text-xs font-bold text-[var(--ax-text-muted)]">기능 필터</span>
          <button onClick={() => setSel(new Set(allOn ? [] : ALL_FEATURES))} className="rounded-full border border-[var(--ax-border)] px-2.5 py-1 text-xs font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">{allOn ? "전체 해제" : "전체 선택"}</button>
          <div className="flex flex-wrap gap-1.5">
            {ALL_FEATURES.map((f) => {
              const on = sel.has(f);
              return (
                <button key={f} onClick={() => toggle(f)} className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${on ? "bg-[var(--ax-accent)] text-white" : "border border-[var(--ax-border)] bg-white text-[var(--ax-text-hint)]"}`}>{FEATURE_LABEL[f]}</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 요약 카드 3층 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="사이트 접속(방문)" value={data?.visits ?? 0} hint="홈 진입 기준 · 기능 필터 무관" tone="accent" />
        <StatCard label="패널 진입" value={data?.entersTotal ?? 0} hint="선택 기능 진입 합" tone="muted" />
        <StatCard label="주요기능 실행" value={data?.total ?? 0} hint="AI 실행·핵심 액션 합" tone="success" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-[var(--ax-text-muted)]"><b className="text-[var(--ax-text)]">{periodLabel(period)}</b> 집계 · 접속 <b className="text-[var(--ax-text)]">{data?.visits ?? 0}</b> · 진입 <b className="text-[var(--ax-text)]">{data?.entersTotal ?? 0}</b> · 실행 <b className="text-[var(--ax-text)]">{data?.total ?? 0}</b></div>
        {hasData && (
          <button onClick={exportCsv} className="flex items-center gap-1 rounded-lg border border-[var(--ax-border)] px-3 py-1.5 text-xs font-semibold text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">
            <span className="material-symbols-outlined text-[14px]">download</span>CSV 다운로드
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</div>
      ) : !hasData ? (
        <div className="rounded-2xl border border-dashed border-[var(--ax-border)] py-16 text-center text-sm text-[var(--ax-text-hint)]">{sel.size === 0 ? "기능을 1개 이상 선택하세요." : "선택한 조건에 집계된 기록이 없습니다."}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* 기능별 진입·실행 */}
            <div className="rounded-2xl border border-[var(--ax-border)] bg-white p-5 shadow-sm">
              <div className="mb-3 text-sm font-bold text-[var(--ax-text)]">기능별 진입 · 실행</div>
              <div className="space-y-2.5">
                {data.byFeature.map((f) => (
                  <div key={f.feature} className="flex items-center gap-2">
                    <div className="w-24 flex-none truncate text-xs text-[var(--ax-text-muted)]" title={FEATURE_LABEL[f.feature] ?? f.feature}>{FEATURE_LABEL[f.feature] ?? f.feature}</div>
                    <div className="w-14 flex-none text-right text-[11px] tabular-nums text-[var(--ax-text-hint)]" title="패널 진입">진입 {f.enter}</div>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-[var(--ax-border-soft)]" title="주요기능 실행">
                      <div className="h-full rounded bg-[var(--ax-accent)]" style={{ width: `${(f.use / maxUse) * 100}%` }} />
                    </div>
                    <div className="w-10 flex-none text-right text-xs font-bold tabular-nums text-[var(--ax-text)]" title="주요기능 실행">{f.use}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-[var(--ax-border-soft)] pt-2 text-[11px] text-[var(--ax-text-hint)]">막대=주요기능 실행 · 좌측=패널 진입. 매거진 등 조회형은 실행이 0일 수 있습니다.</div>
            </div>

            {/* 일별 추이 — 접속/진입/실행 선택 */}
            <div className="rounded-2xl border border-[var(--ax-border)] bg-white p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-[var(--ax-text)]">일별 추이</div>
                <div className="flex gap-0.5 rounded-lg border border-[var(--ax-border)] p-0.5">
                  {SERIES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setSeries(s.key)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${series === s.key ? "text-white" : "text-[var(--ax-text-hint)] hover:bg-[var(--ax-border-soft)]"}`}
                      style={series === s.key ? { backgroundColor: s.color } : undefined}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {seriesTotal === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--ax-text-hint)]">선택한 기간에 {cur.label} 기록이 없습니다.</div>
              ) : (
                <div className="flex h-44 items-end gap-1">
                  {data.byDay.map((d) => (
                    <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.day} · 접속 ${d.visit} / 진입 ${d.enter} / 실행 ${d.use}`}>
                      {data.byDay.length <= 31 && <div className="text-[10px] font-semibold tabular-nums text-[var(--ax-text-muted)]">{d[series]}</div>}
                      <div className="w-full rounded-t" style={{ height: `${Math.max(3, Math.round((d[series] / maxD) * 120))}px`, backgroundColor: cur.color }} />
                      <div className="whitespace-nowrap text-[9px] text-[var(--ax-text-hint)]">{d.day.slice(5)}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 border-t border-[var(--ax-border-soft)] pt-2 text-[11px] text-[var(--ax-text-hint)]">
                {series === "visit"
                  ? "접속은 홈 진입 기준이며 기능 필터의 영향을 받지 않습니다."
                  : "막대에 마우스를 올리면 그날의 접속·진입·실행을 모두 볼 수 있습니다."}
              </div>
            </div>
          </div>

          {/* 실행 세부(유형) — 문서작성·라이브러리 등 다중 액션 기능 */}
          {multiActionFeatures.length > 0 && (
            <div className="rounded-2xl border border-[var(--ax-border)] bg-white p-5 shadow-sm">
              <div className="mb-3 text-sm font-bold text-[var(--ax-text)]">실행 세부 (기능별 유형)</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {multiActionFeatures.map(([feat, arr]) => {
                  const sum = arr.reduce((s, x) => s + x.count, 0);
                  return (
                    <div key={feat} className="rounded-xl border border-[var(--ax-border-soft)] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-bold text-[var(--ax-text)]">{FEATURE_LABEL[feat] ?? feat}</span>
                        <span className="text-[11px] tabular-nums text-[var(--ax-text-hint)]">합 {sum}</span>
                      </div>
                      <div className="space-y-1.5">
                        {[...arr].sort((a, b) => b.count - a.count).map((x) => (
                          <div key={x.action} className="flex items-center gap-2">
                            <div className="w-16 flex-none text-[11px] text-[var(--ax-text-muted)]">{ACTION_LABEL[x.action] ?? x.action}</div>
                            <div className="h-3.5 flex-1 overflow-hidden rounded bg-[var(--ax-border-soft)]">
                              <div className="h-full rounded bg-[var(--ax-accent)]" style={{ width: `${(x.count / Math.max(1, ...arr.map((a) => a.count))) * 100}%` }} />
                            </div>
                            <div className="w-9 flex-none text-right text-[11px] font-bold tabular-nums text-[var(--ax-text)]">{x.count}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
