"use client";

import { useState } from "react";
import type { SalesAnalysisResult, HourlyPoint, DowPoint } from "@/lib/salesAnalysis";

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}
/** 세로막대 라벨용 축약 금액(예: 11,071,250 → 1,107만) */
function wonShort(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return `${Math.round(n).toLocaleString("ko-KR")}`;
}
function maxOf(arr: number[]): number {
  return arr.reduce((m, v) => (v > m ? v : m), 0) || 1;
}

type VBar = { label: string; value: string; ratio: number; color: string; tip?: string };

/** 세로 막대 그래프 (막대 트랙 + 값 + 라벨, 막대 많으면 가로 스크롤) */
function VBars({ bars }: { bars: VBar[] }) {
  const n = bars.length;
  const showVal = n <= 10;
  const needScroll = n > 14;
  const minW = needScroll ? n * 34 : undefined;
  return (
    <div className="overflow-x-auto pb-1">
      <div style={{ minWidth: minW }}>
        <div className="flex items-end gap-1.5 h-[200px]">
          {bars.map((b, i) => (
            <div key={i} className="flex-1 min-w-[16px] h-full flex items-end justify-center" title={b.tip ?? `${b.label}: ${b.value}`}>
              <div className="w-full max-w-[36px] rounded-t-md transition-all hover:opacity-80" style={{ height: `${Math.max(2, b.ratio * 100)}%`, background: b.color }} />
            </div>
          ))}
        </div>
        {showVal && (
          <div className="flex gap-1.5 mt-1.5">
            {bars.map((b, i) => (
              <div key={i} className="flex-1 min-w-[16px] text-center text-[10px] font-bold text-gray-700 tabular-nums whitespace-nowrap">{b.value}</div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 mt-1">
          {bars.map((b, i) => (
            <div key={i} className="flex-1 min-w-[16px] text-center text-[10px] text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis">{b.label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 시간대별 매출·객수 (거래단위 데이터 있을 때만 의미) */
function HourlySection({ hourly }: { hourly: HourlyPoint[] }) {
  const [mode, setMode] = useState<"amount" | "visitors">("amount");
  const valMax = maxOf(hourly.map((h) => (mode === "amount" ? h.amount : h.visitors)));
  const peak = hourly.reduce((p, h) => (h.amount > (p?.amount ?? 0) ? h : p), hourly[0]);
  const bars: VBar[] = hourly.map((h) => {
    const v = mode === "amount" ? h.amount : h.visitors;
    const valStr = mode === "visitors" ? `${h.visitors.toLocaleString()}명` : won(v);
    const cumStr = mode === "visitors" ? `누적 ${h.cumVisitors.toLocaleString()}명` : `누적 ${won(h.cumAmount)}`;
    return { label: `${h.hour}시`, value: mode === "visitors" ? `${h.visitors}` : wonShort(v), ratio: v / valMax, color: "var(--kb)", tip: `${h.hour}시 · ${valStr} · ${cumStr}` };
  });
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="border-l-4 border-[var(--kb)] pl-2.5">
          <div className="text-[15px] font-bold text-gray-800">⏰ 시간대별 매출</div>
          <div className="text-[11px] text-gray-400">매출·객수 · 피크 {peak?.hour}시</div>
        </div>
        <div className="flex gap-1 text-[11px]">
          {([["amount", "매출"], ["visitors", "객수"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setMode(k)} className={`px-2.5 py-1 rounded-full font-semibold ${mode === k ? "bg-[var(--kb)] text-white" : "bg-gray-100 text-gray-600"}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <VBars bars={bars} />
    </div>
  );
}

/** 요일별 매출 */
function DowSection({ dow }: { dow: DowPoint[] }) {
  const [byAvg, setByAvg] = useState(true);
  const vmax = maxOf(dow.map((d) => (byAvg ? d.avgAmount : d.amount)));
  const bars: VBar[] = dow.map((d) => {
    const v = byAvg ? d.avgAmount : d.amount;
    return { label: d.label, value: wonShort(v), ratio: v / vmax, color: d.dow >= 5 ? "var(--kr)" : "var(--kb)", tip: `${d.label} · ${won(v)} · ${d.days}일` };
  });
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="border-l-4 border-[var(--kc)] pl-2.5">
          <div className="text-[15px] font-bold text-gray-800">📅 요일별 매출</div>
          <div className="text-[11px] text-gray-400">{byAvg ? "요일 일평균(일수 보정)" : "요일 총매출"}</div>
        </div>
        <div className="flex gap-1 text-[11px]">
          {([["avg", "일평균"], ["sum", "총매출"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setByAvg(k === "avg")} className={`px-2.5 py-1 rounded-full font-semibold ${(byAvg ? "avg" : "sum") === k ? "bg-[var(--kc)] text-white" : "bg-gray-100 text-gray-600"}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <VBars bars={bars} />
    </div>
  );
}

/** 매출 중심 분석 (시간대·요일). 기간별 추이는 결과 상단 '일별 매출 추이(일/주/월)' 차트로 일원화. */
export function SalesByPeriod({ result }: { result: SalesAnalysisResult }) {
  const hasHourly = result.hourly?.length > 0;
  const hasDow = result.dayOfWeek?.length > 0;
  if (!hasHourly && !hasDow) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {hasHourly && <HourlySection hourly={result.hourly} />}
      {hasDow && <DowSection dow={result.dayOfWeek} />}
    </div>
  );
}
