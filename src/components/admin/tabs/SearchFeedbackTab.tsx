"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PeriodPicker, periodParams, type Period } from "@/components/admin/PeriodPicker";

type FbRow = { id: string; day: string; createdAt: string; question: string; answer: string; reason: string; imageUrl: string; mode: string; intent: string; citations: string[]; status: string; usedVector?: boolean; usedGraph?: boolean };
type Stats = {
  panel: string; isKnowledge: boolean;
  range: { from: string; to: string };
  summary: { total: number; up: number; down: number; satisfaction: number | null; unhandled: number };
  trend: { day: string; up: number; down: number }[];
  topCitations: { title: string; count: number }[];
  byMode: { fast: { up: number; down: number; rate: number | null }; deep: { up: number; down: number; rate: number | null } } | null;
  channelStat?: { total: number; vector: number; graph: number } | null;
  list: FbRow[]; page: number; listTotal: number; limit: number;
};

/** 피드백 지원 패널 — 관리자 분석 그룹. 지식검색만 mode/사규 통계 보유. */
const PANELS = [
  { key: "knowledge", label: "지식검색" },
  { key: "docs", label: "문서작성" },
  { key: "safety", label: "스마트안전관리" },
  { key: "cs", label: "민원답변" },
  { key: "ad", label: "광고도안심의" },
] as const;
type PanelKey = (typeof PANELS)[number]["key"];

const STATUS_LABEL: Record<string, string> = { new: "미처리", reviewed: "검토됨", resolved: "해결됨" };
const STATUS_CLS: Record<string, string> = {
  new: "bg-[#fdeaea] text-[#d14343]", reviewed: "bg-[var(--ax-accent-bg)] text-[var(--ax-accent)]", resolved: "bg-[#e6f6ec] text-[#1d7a44]",
};

function Card({ label, value, accent }: { label: string; value: number | string; accent?: "green" | "red" }) {
  const color = accent === "green" ? "text-[#1d7a44]" : accent === "red" ? "text-[#d14343]" : "text-[var(--ax-text)]";
  return (
    <div className="rounded-lg bg-[var(--ax-border-soft)] px-3 py-2.5">
      <p className="mb-1 text-xs text-[var(--ax-text-muted)]">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
function ModeBar({ label, rate }: { label: string; rate: number | null }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="font-bold">{rate != null ? `${rate}%` : "—"}</span></div>
      <div className="h-2 rounded-full bg-[var(--ax-border-soft)]"><div className="h-2 rounded-full bg-[var(--ax-accent)]" style={{ width: `${rate ?? 0}%` }} /></div>
    </div>
  );
}

export default function SearchFeedbackTab() {
  const [period, setPeriod] = useState<Period>({ mode: "preset", days: 30 });
  const [panelF, setPanelF] = useState<PanelKey>("knowledge");
  const [modeF, setModeF] = useState<"all" | "fast" | "deep">("all");
  const [statusF, setStatusF] = useState<"all" | "new" | "reviewed" | "resolved">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<FbRow | null>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<{ destroy: () => void } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams(periodParams(period));
    qs.set("panel", panelF);
    if (modeF !== "all") qs.set("mode", modeF);
    if (statusF !== "all") qs.set("status", statusF);
    qs.set("page", String(page));
    try { const r = await fetch(`/api/admin/feedback?${qs.toString()}`); if (r.ok) setData(await r.json()); }
    finally { setLoading(false); }
  }, [period, panelF, modeF, statusF, page]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let mounted = true;
    if (!data || !chartRef.current) return;
    (async () => {
      type ChartCtor = new (c: HTMLCanvasElement, cfg: object) => { destroy: () => void };
      const mod = await import("chart.js/auto");
      const ChartJS = (mod as unknown as { default: ChartCtor }).default;
      if (!mounted || !chartRef.current) return;
      chartInst.current?.destroy();
      chartInst.current = new ChartJS(chartRef.current, {
        type: "bar",
        data: {
          labels: data.trend.map((t) => t.day.slice(5)),
          datasets: [
            { label: "도움됨", data: data.trend.map((t) => t.up), backgroundColor: "#1D9E75" },
            { label: "아쉬움", data: data.trend.map((t) => t.down), backgroundColor: "#E24B4A" },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
      });
    })();
    return () => { mounted = false; chartInst.current?.destroy(); chartInst.current = null; };
  }, [data]);

  const setStatus = async (id: string, status: string) => {
    await fetch("/api/admin/feedback", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    setDetail(null); void load();
  };
  const exportCsv = () => {
    const qs = new URLSearchParams(periodParams(period));
    qs.set("panel", panelF);
    if (modeF !== "all") qs.set("mode", modeF);
    if (statusF !== "all") qs.set("status", statusF);
    const a = document.createElement("a"); a.href = `/api/admin/feedback/export?${qs.toString()}`; a.click();
  };

  const s = data?.summary;
  const totalPages = data ? Math.max(1, Math.ceil(data.listTotal / data.limit)) : 1;
  const selCls = "rounded-lg border border-[var(--ax-border)] bg-[var(--ax-card)] px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={(p) => { setPage(1); setPeriod(p); }} presets={[7, 14, 30, 90]} />
        <select value={panelF} onChange={(e) => { setPage(1); setPanelF(e.target.value as PanelKey); }} className={selCls}>
          {PANELS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {panelF === "knowledge" && (
          <select value={modeF} onChange={(e) => { setPage(1); setModeF(e.target.value as typeof modeF); }} className={selCls}>
            <option value="all">전체 모드</option><option value="fast">빠른</option><option value="deep">심층</option>
          </select>
        )}
        <select value={statusF} onChange={(e) => { setPage(1); setStatusF(e.target.value as typeof statusF); }} className={selCls}>
          <option value="all">전체 상태</option><option value="new">미처리</option><option value="reviewed">검토됨</option><option value="resolved">해결됨</option>
        </select>
        <button type="button" onClick={exportCsv} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[var(--ax-border)] px-3 py-1.5 text-sm text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]">
          <span className="material-symbols-outlined text-[16px]">download</span>CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card label="총 피드백" value={s?.total ?? "—"} />
        <Card label="만족도" value={s?.satisfaction != null ? `${s.satisfaction}%` : "—"} accent="green" />
        <Card label="도움됨" value={s?.up ?? "—"} />
        <Card label="아쉬움" value={s?.down ?? "—"} />
        <Card label="미처리" value={s?.unhandled ?? "—"} accent="red" />
      </div>

      <div className="rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold">일별 만족도 추세</span>
          <span className="flex gap-3 text-xs text-[var(--ax-text-muted)]">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#1D9E75]" />도움됨</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#E24B4A]" />아쉬움</span>
          </span>
        </div>
        <div className="relative h-[200px]"><canvas ref={chartRef} /></div>
      </div>

      {/* 사규 Top·모드별·채널 통계는 지식검색 전용(생성형 패널엔 사규·검색모드 개념이 없음) */}
      {data?.isKnowledge && data.byMode && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-4">
            <p className="mb-2 text-sm font-bold">불만족 많은 사규 Top</p>
            {data.topCitations.length ? data.topCitations.map((t) => (
              <div key={t.title} className="flex justify-between border-b border-[var(--ax-border-soft)] py-1.5 text-sm last:border-0">
                <span className="truncate pr-2">{t.title}</span><span className="shrink-0 text-[#d14343]">{t.count}건</span>
              </div>
            )) : <p className="text-xs text-[var(--ax-text-hint)]">데이터 없음</p>}
          </div>
          <div className="rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-4">
            <p className="mb-2 text-sm font-bold">모드별 만족도</p>
            <ModeBar label="빠른 검색" rate={data.byMode.fast.rate} />
            <ModeBar label="심층 검색" rate={data.byMode.deep.rate} />
            {data.channelStat && (
              <div className="mt-3 border-t border-[var(--ax-border-soft)] pt-2 text-xs text-[var(--ax-text-muted)]">
                <span className="font-semibold">검색 채널 적용</span>(평가 {data.channelStat.total}건 중) ·{" "}
                <span className="text-[#1a56db]">의미 {data.channelStat.vector}</span> ·{" "}
                <span className="text-[#b45309]">그래프 {data.channelStat.graph}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-4">
        <p className="mb-2 text-sm font-bold">불만족 의견 (아쉬움) <span className="font-normal text-[var(--ax-text-hint)]">{data ? `· ${data.listTotal}건` : ""}</span></p>
        {loading && !data ? <p className="py-4 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</p> : !data?.list.length ? (
          <p className="py-4 text-center text-sm text-[var(--ax-text-hint)]">불만족 의견이 없습니다.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead><tr className="text-xs text-[var(--ax-text-muted)]">
                  <th className="py-1.5 pr-2 font-normal">일시</th><th className="py-1.5 pr-2 font-normal">질문 · 사유</th>
                  <th className="py-1.5 pr-2 font-normal">이미지</th><th className="py-1.5 pr-2 font-normal">모드</th><th className="py-1.5 pr-2 font-normal">검색채널</th><th className="py-1.5 font-normal">상태</th>
                </tr></thead>
                <tbody>
                  {data.list.map((r) => (
                    <tr key={r.id} onClick={() => setDetail(r)} className="cursor-pointer border-t border-[var(--ax-border-soft)] hover:bg-[var(--ax-border-soft)]">
                      <td className="py-2 pr-2 align-top text-[var(--ax-text-hint)] whitespace-nowrap">{String(r.createdAt).slice(5, 10)}</td>
                      <td className="py-2 pr-2 align-top"><div className="font-medium text-[var(--ax-text)]">{r.question || "(질문 없음)"}</div>{r.reason && <div className="mt-0.5 text-[var(--ax-text-muted)]">{r.reason}</div>}</td>
                      <td className="py-2 pr-2 align-top">{r.imageUrl ? <span className="material-symbols-outlined text-[16px] text-[var(--ax-accent)]">image</span> : <span className="text-[var(--ax-text-hint)]">—</span>}</td>
                      <td className="py-2 pr-2 align-top"><span className="rounded-md bg-[var(--ax-border-soft)] px-1.5 py-0.5 text-[11px]">{r.mode === "deep" ? "심층" : "빠른"}</span></td>
                      <td className="py-2 pr-2 align-top">
                        <span className="flex flex-wrap gap-1">
                          {r.usedVector && <span className="rounded bg-[#e8f0fe] px-1.5 py-0.5 text-[11px] text-[#1a56db]">의미</span>}
                          {r.usedGraph && <span className="rounded bg-[#fef3e8] px-1.5 py-0.5 text-[11px] text-[#b45309]">그래프</span>}
                          {!r.usedVector && !r.usedGraph && <span className="text-[11px] text-[var(--ax-text-hint)]">키워드</span>}
                        </span>
                      </td>
                      <td className="py-2 align-top"><span className={`rounded-md px-1.5 py-0.5 text-[11px] ${STATUS_CLS[r.status] ?? ""}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-2 text-sm">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-[var(--ax-border)] px-2 py-1 disabled:opacity-40">이전</button>
                <span className="text-[var(--ax-text-muted)]">{page} / {totalPages}</span>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-[var(--ax-border)] px-2 py-1 disabled:opacity-40">다음</button>
              </div>
            )}
          </>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--ax-border)] bg-[var(--ax-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-bold"><span className="material-symbols-outlined text-[18px] text-[#d14343]">thumb_down</span>불만족 의견 상세</span>
              <button type="button" onClick={() => setDetail(null)} className="material-symbols-outlined text-[20px] text-[var(--ax-text-muted)]">close</button>
            </div>
            <Field label="질문">{detail.question || "—"}</Field>
            {detail.intent && <Field label="파악된 의도">{detail.intent}</Field>}
            <Field label="불만족 사유">{detail.reason || "—"}</Field>
            <Field label="인용 사규">{detail.citations?.length ? detail.citations.join(" · ") : "—"}</Field>
            <Field label="AI 답변"><div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--ax-border-soft)] p-2 text-[13px]">{detail.answer || "—"}</div></Field>
            {detail.imageUrl && <Field label="참고 이미지"><a href={detail.imageUrl} target="_blank" rel="noreferrer"><img src={detail.imageUrl} alt="참고" className="max-h-60 rounded-lg border border-[var(--ax-border)]" /></a></Field>}
            <div className="mt-4 flex items-center gap-2 border-t border-[var(--ax-border)] pt-3">
              <span className="text-xs text-[var(--ax-text-muted)]">처리상태</span>
              {(["new", "reviewed", "resolved"] as const).map((st) => (
                <button key={st} type="button" onClick={() => setStatus(detail.id, st)} className={`rounded-lg px-3 py-1.5 text-sm transition ${detail.status === st ? "bg-[var(--ax-accent)] text-white" : "border border-[var(--ax-border)] text-[var(--ax-text-muted)] hover:bg-[var(--ax-border-soft)]"}`}>{STATUS_LABEL[st]}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <p className="mb-1 text-xs font-bold text-[var(--ax-text-muted)]">{label}</p>
      <div className="text-sm text-[var(--ax-text)]">{children}</div>
    </div>
  );
}
