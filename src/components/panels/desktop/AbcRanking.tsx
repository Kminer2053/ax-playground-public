"use client";

import { useState } from "react";
import type { SalesAnalysisResult, AbcItem } from "@/lib/salesAnalysis";

function won(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return `${Math.round(n).toLocaleString("ko-KR")}`;
}

const GRADE_COLOR: Record<"A" | "B" | "C", string> = {
  A: "var(--kb)",
  B: "var(--kc)",
  C: "#9ca3af",
};
const GRADE_DESC: Record<"A" | "B" | "C", string> = {
  A: "누적매출 0~20% · 핵심상품",
  B: "누적매출 20~50% · 주력상품",
  C: "누적매출 50~100% · 일반/저회전",
};

/** ABC 등급 요약 (등급별 품목수·매출비중) */
function GradeSummary({ items }: { items: AbcItem[] }) {
  const total = items.reduce((s, p) => s + p.totalAmount, 0) || 1;
  const grades: Array<"A" | "B" | "C"> = ["A", "B", "C"];
  return (
    <div className="grid grid-cols-3 gap-2">
      {grades.map((g) => {
        const list = items.filter((p) => p.grade === g);
        const amt = list.reduce((s, p) => s + p.totalAmount, 0);
        return (
          <div key={g} className="rounded-lg p-3 border" style={{ borderColor: GRADE_COLOR[g], background: `${GRADE_COLOR[g]}10` }}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-black" style={{ color: GRADE_COLOR[g] }}>{g}</span>
              <span className="text-[11px] font-bold text-gray-700">{list.length}품목</span>
            </div>
            <div className="text-[13px] font-bold text-gray-800 mt-0.5">{won(amt)}원</div>
            <div className="text-[10px] text-gray-400 mt-0.5">매출 {((amt / total) * 100).toFixed(0)}% · {GRADE_DESC[g]}</div>
          </div>
        );
      })}
    </div>
  );
}

/** ABC 순위표 — 등급 / 우리순위 / 전체순위 / 순위격차 / 파레토 누적선 */
function AbcTable({ items }: { items: AbcItem[] }) {
  const [grade, setGrade] = useState<"all" | "A" | "B" | "C">("all");
  const filtered = grade === "all" ? items : items.filter((p) => p.grade === grade);
  const rows = filtered.slice(0, 30);

  return (
    <div>
      <div className="flex gap-1 text-[11px] mb-2.5">
        {([["all", "전체"], ["A", "A등급"], ["B", "B등급"], ["C", "C등급"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setGrade(k)}
            className={`px-2.5 py-1 rounded-full font-semibold ${grade === k ? "bg-[var(--kb)] text-white" : "bg-gray-100 text-gray-600"}`}>{lbl}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-gray-400 border-b border-gray-200">
              <th className="text-left font-semibold py-1.5 pr-2">순위</th>
              <th className="text-left font-semibold py-1.5 pr-2">상품</th>
              <th className="text-center font-semibold py-1.5 px-1">등급</th>
              <th className="text-right font-semibold py-1.5 px-2">매출</th>
              <th className="text-right font-semibold py-1.5 px-2">누적%</th>
              <th className="text-center font-semibold py-1.5 pl-2">순위격차</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const gap = p.allRank != null ? p.allRank - p.ourRank : null;
              // gap>0: 전체 대비 우리가 더 잘 파는 상품(강점), gap<0: 전체는 잘 팔리는데 우리는 약함(기회)
              const gapColor = gap == null ? "#9ca3af" : gap > 0 ? "var(--kb)" : gap < 0 ? "var(--kr)" : "#9ca3af";
              const gapLabel = gap == null ? "—" : gap > 0 ? `▲${gap}` : gap < 0 ? `▼${Math.abs(gap)}` : "0";
              return (
                <tr key={p.productCode} className="border-b border-gray-50 last:border-0">
                  <td className="py-1.5 pr-2 tabular-nums text-gray-500">{p.ourRank}</td>
                  <td className="py-1.5 pr-2 font-medium text-gray-800 truncate max-w-[140px]" title={p.productName}>{p.productName}</td>
                  <td className="py-1.5 px-1 text-center">
                    <span className="inline-block w-4 h-4 leading-4 rounded text-white text-[9px] font-bold" style={{ background: GRADE_COLOR[p.grade] }}>{p.grade}</span>
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-gray-700">{won(p.totalAmount)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-gray-400">{(p.cumShare * 100).toFixed(0)}%</td>
                  <td className="py-1.5 pl-2 text-center tabular-nums font-bold" style={{ color: gapColor }} title={p.allRank != null ? `전체 ${p.allRank}위` : "전체 순위 없음"}>{gapLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-2.5 text-[10px] text-gray-400">
        <span><b style={{ color: "var(--kb)" }}>▲</b> 전체 대비 강점</span>
        <span><b style={{ color: "var(--kr)" }}>▼</b> 전체 대비 약점(기회)</span>
        <span className="ml-auto">순위격차 = 전체순위 − 우리순위</span>
      </div>
    </div>
  );
}

/** 상품 ABC 분석 (금액 기준 파레토 + 순위격차) */
export function AbcRanking({ result }: { result: SalesAnalysisResult }) {
  const items = result.abcRanking;
  if (!items?.length) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 space-y-4">
      <div className="border-l-4 border-[var(--kb)] pl-2.5">
        <div className="text-[15px] font-bold text-gray-800">🔠 상품 ABC 분석</div>
        <div className="text-[11px] text-gray-400">금액 기준 파레토 · 등급(A/B/C) · 우리 vs 전체 순위격차</div>
      </div>
      <GradeSummary items={items} />
      <AbcTable items={items} />
    </div>
  );
}
