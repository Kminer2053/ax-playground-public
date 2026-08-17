"use client";

/**
 * 매출 분석 결과 공유 뷰 — 데모(PanelSales)와 업로드(PanelSalesUpload)가 모두 사용.
 * 외부에서 result만 넘기면 KPI·진단·차트·재고경보까지 일괄 렌더.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { SalesByPeriod } from "./SalesByPeriod";
import { SalesTabs } from "./SalesTabs";
import type { SalesAnalysisResult, Insight } from "@/lib/salesAnalysis";

interface Props {
  result: SalesAnalysisResult;
  onBack: () => void;
  backLabel: string;
}

function fmt(n: number) { return n.toLocaleString("ko-KR"); }
// 금액 표기 정책: 1천만원 미만은 '천원', 1천만원 이상은 '만원', 1억원 이상은 'X억 Y만원'으로 분리.
// (입력 n은 원 단위)
function fmtWon(n: number) {
  const won = Math.round(n);
  if (won >= 100_000_000) {
    const eok = Math.floor(won / 100_000_000);
    const man = Math.round((won % 100_000_000) / 10_000);
    return man > 0 ? `${eok}억 ${fmt(man)}만원` : `${eok}억원`;
  }
  if (won >= 10_000_000) return `${fmt(Math.round(won / 10_000))}만원`;
  if (won >= 1_000) return `${fmt(Math.round(won / 1_000))}천원`;
  return `${fmt(won)}원`;
}

type TsPoint = { date: string; amount: number; ma7: number | null; compareAmount: number | null };
type AggPoint = { label: string; amount: number; ma7: number | null; compareAmount: number | null };

/** 일간(그대로) / 주간(7일 합계) 막대 시리즈. */
function aggregateSeries(ts: TsPoint[], mode: "daily" | "weekly"): AggPoint[] {
  if (mode === "daily") {
    return ts.map((p) => ({ label: p.date.slice(5), amount: p.amount, ma7: p.ma7, compareAmount: p.compareAmount }));
  }
  const out: AggPoint[] = [];
  for (let i = 0; i < ts.length; i += 7) {
    const chunk = ts.slice(i, i + 7);
    const amount = chunk.reduce((s, p) => s + p.amount, 0);
    const hasC = chunk.some((p) => p.compareAmount !== null);
    const compareAmount = hasC ? chunk.reduce((s, p) => s + (p.compareAmount ?? 0), 0) : null;
    out.push({ label: `${chunk[0].date.slice(5)}~${chunk[chunk.length - 1].date.slice(5)}`, amount, ma7: null, compareAmount });
  }
  return out;
}

/** 월간 요약(막대 대신 표): 월·총매출·일수·일평균. */
function monthlyRows(ts: TsPoint[]) {
  const map = new Map<string, { label: string; amount: number; days: number }>();
  for (const p of ts) {
    const ym = p.date.slice(0, 7);
    const e = map.get(ym) ?? { label: ym, amount: 0, days: 0 };
    e.amount += p.amount;
    e.days += 1;
    map.set(ym, e);
  }
  return [...map.values()].map((m) => ({ ...m, dailyAvg: m.days ? m.amount / m.days : 0 }));
}

type DiagState = "idle" | "loading" | "done" | "error";

export function SalesResultView({ result, onBack, backLabel }: Props) {
  const [diagState, setDiagState] = useState<DiagState>("idle");
  const [diagText, setDiagText] = useState("");
  const [diagError, setDiagError] = useState("");
  const mainChartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<{ destroy: () => void } | null>(null);
  const [chartMode, setChartMode] = useState<"daily" | "weekly" | "monthly">("daily");

  // result 키 — 새 매장/파일 들어오면 진단 리셋
  const resultKey = `${result.storeName}|${result.compareStoreName}|${result.period.start}|${result.period.end}`;

  const handleDiagnosis = useCallback(async () => {
    if (!result?.diagnosisContext) return;
    setDiagState("loading");
    setDiagText("");
    setDiagError("");
    try {
      const res = await fetch("/api/sales/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ analysisContext: result.diagnosisContext, storeName: result.storeName }),
      });
      const data = (await res.json()) as { ok?: boolean; diagnosis?: string; error?: string; provider?: string };
      if (!res.ok || !data.ok || !data.diagnosis) {
        setDiagError(data.error ?? "진단 실패");
        setDiagState("error");
        return;
      }
      setDiagText(data.diagnosis);
      setDiagState("done");
    } catch (e) {
      setDiagError(String(e));
      setDiagState("error");
    }
  }, [result]);

  // 결과 바뀌면 자동 진단
  useEffect(() => {
    handleDiagnosis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey]);

  // 차트
  useEffect(() => {
    if (!result?.timeSeries?.length || !mainChartRef.current) return;
    let mounted = true;
    (async () => {
      type ChartCtor = new (canvas: HTMLCanvasElement, config: object) => { destroy: () => void };
      const chartAuto = await import("chart.js/auto");
      const ChartJS: ChartCtor = (chartAuto as unknown as { default: ChartCtor }).default;
      if (!mounted || !mainChartRef.current) return;
      chartInstance.current?.destroy();
      const agg = aggregateSeries(result.timeSeries as TsPoint[], chartMode === "weekly" ? "weekly" : "daily");
      const hasCompare = agg.some((p) => p.compareAmount !== null);
      const datasets: object[] = [
        { type: "bar" as const, label: "우리 매장", data: agg.map((p) => Math.round(p.amount / 10_000)), backgroundColor: "rgba(0,84,166,0.7)", borderRadius: 3, maxBarThickness: 46, order: 2 },
      ];
      if (chartMode === "daily") {
        datasets.push({ type: "line" as const, label: "7일 이동평균", data: agg.map((p) => (p.ma7 !== null ? Math.round(p.ma7 / 10_000) : null)), borderColor: "#e74c3c", borderWidth: 2, pointRadius: 0, fill: false, tension: 0.4, order: 1 });
      }
      if (hasCompare) {
        datasets.push({ type: "line" as const, label: result.compareStoreName || "비교 매장", data: agg.map((p) => (p.compareAmount !== null ? Math.round(p.compareAmount / 10_000) : null)), borderColor: "#bbb", borderWidth: 1.5, borderDash: [5, 5], pointRadius: 0, fill: false, tension: 0.4, order: 3 });
      }
      chartInstance.current = new ChartJS(mainChartRef.current, {
        type: "bar",
        data: { labels: agg.map((p) => p.label), datasets },
        options: {
          indexAxis: "x", // 세로 막대
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx: { dataset?: { label?: string }; parsed?: { y?: number } }) => `${ctx.dataset?.label ?? ""}: ${fmtWon((ctx.parsed?.y ?? 0) * 10_000)}` } },
          },
          scales: {
            y: { beginAtZero: true, ticks: { callback: (v: number | string) => `${v}만` }, grid: { color: "#f5f5f5" } },
            x: { grid: { display: false }, ticks: { maxTicksLimit: chartMode === "daily" ? 16 : 12, font: { size: 10 } } },
          },
        },
      });
    })();
    return () => { mounted = false; chartInstance.current?.destroy(); chartInstance.current = null; };
  }, [result, chartMode]);

  const dangerItems = result.inventoryAlerts.filter((a) => a.status === "danger");
  const highInsights: Insight[] = result.insights.filter((i) => i.level === "high");

  // 파일 이상 감지(검수 슬11) — 일별 매출이 거의 동일(변동계수 < 2%)하면 잘못된 엑셀일 가능성 경고.
  const tsAmt = result.timeSeries.map((p) => p.amount);
  const tsMean = tsAmt.length ? tsAmt.reduce((a, b) => a + b, 0) / tsAmt.length : 0;
  const tsCv = tsMean > 0 ? Math.sqrt(tsAmt.reduce((a, b) => a + (b - tsMean) ** 2, 0) / tsAmt.length) / tsMean : 1;
  const flatWarn = tsAmt.length >= 7 && tsMean > 0 && tsCv < 0.02;

  return (
    <div className="min-h-screen bg-[var(--panel-bg)]">
      <div className="max-w-[1400px] mx-auto flex flex-col gap-4 p-5">
        {/* 헤더 */}
        <PanelHeader
          icon="storefront"
          title="편의점 매출 비교분석"
          backHref="/panel/sales"
          right={
            <div className="flex gap-2 print:hidden">
              <button type="button" onClick={onBack} className="border border-gray-300 text-gray-600 py-2 px-3 rounded-md text-xs font-semibold hover:bg-gray-50">
                {backLabel}
              </button>
              <button type="button" onClick={handleDiagnosis} disabled={diagState === "loading"} className="bg-[var(--kb)] text-white py-2 px-3 rounded-md text-xs font-semibold hover:bg-[#003d7a] disabled:opacity-60">
                {diagState === "loading" ? "⟳ 진단 중..." : "↻ AI 재진단"}
              </button>
              <button type="button" onClick={() => window.print()} className="bg-[var(--kb)] text-white py-2 px-3 rounded-md text-xs font-semibold hover:bg-[#003d7a]">PDF</button>
            </div>
          }
        />
        {/* 분석 대상 매장 컨텍스트 */}
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--ax-text-muted)]">
          <span className="font-bold text-[var(--ax-text)]">📊 {result.storeName || "분석 매장"}</span>
          {result.compareStoreName && (
            <span>vs <span className="font-bold" style={{ color: "var(--kc)" }}>{result.compareStoreName}</span></span>
          )}
          <span className="text-[var(--ax-text-hint)]">· {result.period.start} ~ {result.period.end} ({result.period.days}일) · {result.uniqueProducts}종</span>
        </div>

        {/* 파일 이상 감지 경고 (검수 슬11) */}
        {flatWarn && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
            <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
            <span>일별 매출 추이가 비정상적으로 균일합니다(변동계수 {(tsCv * 100).toFixed(1)}%). 업무사이트에서 <b>기간·항목을 잘못 선택해 내려받은 엑셀</b>일 수 있으니, 표준 양식(일자별 실매출)을 다시 확인해 주세요.</span>
          </div>
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: "분석 기간 총 매출", value: fmtWon(result.totalAmount), icon: "₩", bg: "var(--kb)", show: true },
            { label: "일 평균 매출", value: fmtWon(result.dailyAvgAmount), icon: "📅", bg: "var(--kc)", show: true },
            { label: "방문객 (거래 수)", value: `${fmt(result.visitors)}명`, icon: "👥", bg: "var(--kc)", show: result.visitors > 0 },
            { label: "취급 상품 수", value: `${result.uniqueProducts}종`, icon: "📦", bg: "var(--kg)", show: true },
            { label: "긴급 발주 대상", value: `${dangerItems.length}건`, icon: "🚨", bg: dangerItems.length > 0 ? "var(--kr)" : "var(--kg)", show: true },
          ].filter((k) => k.show).map((kpi, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-gray-500 font-medium">{kpi.label}</span>
                <div className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs" style={{ background: kpi.bg }}>{kpi.icon}</div>
              </div>
              <div className="text-lg font-black text-gray-800">{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* AI 진단 */}
        <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-200 rounded-xl p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-full bg-[var(--kb)] flex items-center justify-center text-white text-lg shrink-0">🤖</div>
            <div>
              <h3 className="text-[var(--kb)] font-extrabold text-sm">AI 매장 진단</h3>
              <p className="text-[11px] text-gray-400">{diagState === "loading" ? "분석 중..." : diagState === "done" ? "AI 진단 생성" : ""}</p>
            </div>
          </div>
          {diagState === "loading" && (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-4"><span className="animate-spin inline-block">⟳</span> AI가 데이터를 분석하고 있습니다...</div>
          )}
          {diagState === "done" && diagText && (
            <div className="prose prose-sm max-w-none text-gray-700 [&_h2]:text-[var(--kb)] [&_h2]:font-extrabold [&_h2]:text-sm [&_h2]:mt-3 [&_h2]:mb-1 [&_ol]:pl-4 [&_ul]:pl-4 [&_strong]:text-gray-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{diagText}</ReactMarkdown>
            </div>
          )}
          {diagState === "error" && (<div className="text-sm text-red-600 py-2">⚠️ {diagError}</div>)}
          {diagState === "idle" && (<p className="text-sm text-gray-500">분석이 완료되면 자동으로 AI 진단이 시작됩니다.</p>)}
        </div>

        {/* 즉시 실행 인사이트 */}
        {highInsights.length > 0 && (
          <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-xl p-5">
            <h3 className="text-orange-800 font-extrabold text-sm mb-3">🔥 즉시 실행 인사이트 ({highInsights.length}건)</h3>
            <div className="space-y-2">
              {highInsights.map((ins, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-amber-100 last:border-0">
                  <div className="w-6 h-6 rounded-full bg-[var(--kr)] flex items-center justify-center text-white text-[11px] font-bold shrink-0">{i + 1}</div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">{ins.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{ins.body}</p>
                    <p className="text-xs text-[var(--kb)] font-semibold mt-0.5">→ {ins.action}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 매출 분석 (일별 추이 → 시간대·요일) ── */}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-base font-extrabold text-gray-800">💰 매출 분석</span>
        </div>

        {/* 일별 매출 추이 — 매출 분석 첫 항목 (일간/주간 차트, 월간 요약표) */}
        {result.timeSeries.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <div className="border-l-4 border-[var(--kc)] pl-2.5 text-[15px] font-bold text-gray-800">
                {chartMode === "daily" ? "일별 매출 추이" : chartMode === "weekly" ? "주간(7일) 매출" : "월간 매출 요약"}
                {chartMode !== "monthly" && (
                  <span className="text-[10px] font-normal text-gray-400 ml-2">
                    ▌ 막대: 우리 매장
                    {chartMode === "daily" && (<> / <span className="text-[var(--kr)]">━</span> 7일이동평균</>)}
                    {result.compareStoreName && <span className="text-gray-400"> / ┅ {result.compareStoreName}</span>}
                  </span>
                )}
              </div>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                {([["daily", "일간"], ["weekly", "주간"], ["monthly", "월간"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setChartMode(m)}
                    className={`px-3 py-1.5 font-semibold ${chartMode === m ? "bg-[var(--kb)] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {chartMode === "monthly" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-gray-400 border-b border-gray-100">
                      <th className="text-left font-semibold py-2">월</th>
                      <th className="text-right font-semibold py-2">총매출</th>
                      <th className="text-right font-semibold py-2">일수</th>
                      <th className="text-right font-semibold py-2">일평균</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRows(result.timeSeries as TsPoint[]).map((m) => (
                      <tr key={m.label} className="border-b border-gray-50">
                        <td className="py-2 font-medium text-gray-800">{m.label}</td>
                        <td className="py-2 text-right tabular-nums text-gray-800">{fmtWon(m.amount)}</td>
                        <td className="py-2 text-right tabular-nums text-gray-500">{m.days}일</td>
                        <td className="py-2 text-right tabular-nums text-gray-600">{fmtWon(m.dailyAvg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-gray-400 mt-2">월간은 건수가 적어 막대그래프 대신 요약 표로 제공합니다.</p>
              </div>
            ) : (
              <div className="min-h-[240px] relative"><canvas ref={mainChartRef} /></div>
            )}
          </div>
        )}

        {/* 시간대·요일 */}
        <SalesByPeriod result={result} />

        {/* 상품 분석 이하 — 탭으로 묶음(자동표출은 매출분석까지) */}
        <SalesTabs result={result} />

        <div className="text-center text-[11px] text-gray-400 py-3">© AX Playground — Smart Sales Analysis</div>
      </div>
    </div>
  );
}
