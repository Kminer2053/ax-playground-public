"use client";

import { useState } from "react";
import type { SalesAnalysisResult, PenetrationItem, PerStoreItem, BasketRule } from "@/lib/salesAnalysis";

function maxOf(arr: number[]): number {
  return arr.reduce((m, v) => (v > m ? v : m), 0) || 1;
}

const GRADE_COLOR: Record<"A" | "B" | "C", string> = { A: "var(--kb)", B: "var(--kc)", C: "#9ca3af" };

/** 침투율 — 전체 매장 중 판매 비율 + 우리 취급 여부 (미취급 고침투 = 필수상품 누락) */
function PenetrationSection({ items }: { items: PenetrationItem[] }) {
  const [onlyMissing, setOnlyMissing] = useState(false);
  const filtered = (onlyMissing ? items.filter((p) => !p.weCarry && p.grade !== "C") : items).slice(0, 20);
  const missingCount = items.filter((p) => p.grade === "A" && !p.weCarry).length;

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="border-l-4 border-[var(--kb)] pl-2.5">
          <div className="text-[15px] font-bold text-gray-800">🏬 상품 침투율</div>
          <div className="text-[11px] text-gray-400">전체 {items[0]?.totalStores ?? 0}개 매장 중 판매 비율 · 필수상품 누락 {missingCount}건</div>
        </div>
        <button onClick={() => setOnlyMissing((v) => !v)}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${onlyMissing ? "bg-[var(--kr)] text-white" : "bg-gray-100 text-gray-600"}`}>
          미취급만
        </button>
      </div>
      <div className="space-y-1.5">
        {filtered.map((p) => (
          <div key={p.productCode} className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 leading-4 rounded text-white text-[9px] font-bold text-center shrink-0" style={{ background: GRADE_COLOR[p.grade] }}>{p.grade}</span>
            <span className="text-[11px] text-gray-700 w-28 shrink-0 truncate" title={p.productName}>{p.productName}</span>
            <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
              <div className="h-full rounded" style={{ width: `${p.penetration * 100}%`, background: p.weCarry ? "var(--kb)" : "var(--kr)" }} />
            </div>
            <span className="text-[11px] font-bold text-gray-800 w-12 text-right tabular-nums">{(p.penetration * 100).toFixed(0)}%</span>
            <span className={`text-[10px] w-12 text-right font-semibold ${p.weCarry ? "text-gray-400" : "text-[var(--kr)]"}`}>{p.weCarry ? "취급" : "미취급"}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 text-[10px] text-gray-400 flex items-center gap-3">
        <span><b style={{ color: "var(--kb)" }}>■</b> 취급중</span>
        <span><b style={{ color: "var(--kr)" }}>■</b> 미취급(도입 검토)</span>
      </div>
    </div>
  );
}

/** 매장당 성과 — 우리 매출 vs 전체 매장당 평균 (1.0 기준선) */
function PerStoreSection({ items }: { items: PerStoreItem[] }) {
  const [view, setView] = useState<"top" | "bottom">("top");
  const sorted = view === "top" ? items : [...items].sort((a, b) => a.ratio - b.ratio);
  const rows = sorted.slice(0, 10);
  const vmax = maxOf(items.map((p) => p.ratio).concat(2)); // 최소 2배까지 눈금

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="border-l-4 border-[var(--kc)] pl-2.5">
          <div className="text-[15px] font-bold text-gray-800">📊 매장당 성과</div>
          <div className="text-[11px] text-gray-400">우리 매출 ÷ 전체 매장당 평균 (1.0=평균)</div>
        </div>
        <div className="flex gap-1 text-[11px]">
          {([["top", "우위 Top"], ["bottom", "부진 Top"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-2.5 py-1 rounded-full font-semibold ${view === k ? "bg-[var(--kc)] text-white" : "bg-gray-100 text-gray-600"}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {rows.map((p) => {
          const strong = p.ratio >= 1;
          return (
            <div key={p.productCode} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-700 w-28 shrink-0 truncate" title={p.productName}>{p.productName}</span>
              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden relative">
                {/* 1.0 기준선 */}
                <div className="absolute top-0 bottom-0 w-px bg-gray-300" style={{ left: `${(1 / vmax) * 100}%` }} />
                <div className="h-full rounded" style={{ width: `${Math.min(p.ratio / vmax, 1) * 100}%`, background: strong ? "var(--kb)" : "var(--kr)" }} />
              </div>
              <span className="text-[11px] font-bold w-12 text-right tabular-nums" style={{ color: strong ? "var(--kb)" : "var(--kr)" }}>{p.ratio.toFixed(2)}x</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** MBA — 함께 구매한 상품 연관규칙 (거래단위 데이터 있을 때만) */
function BasketSection({ rules }: { rules: BasketRule[] }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
      <div className="border-l-4 border-[var(--kb)] pl-2.5 mb-3">
        <div className="text-[15px] font-bold text-gray-800">🧺 장바구니 분석 (MBA)</div>
        <div className="text-[11px] text-gray-400">함께 구매한 상품 조합 — 연관진열·번들 전략</div>
      </div>
      <div className="space-y-1.5">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
            <span className="text-[10px] text-gray-400 w-4 shrink-0 text-right tabular-nums">{i + 1}</span>
            <div className="flex-1 min-w-0 flex items-center gap-1 text-[12px]">
              <span className="font-semibold text-gray-800 truncate">{r.a}</span>
              <span className="text-[var(--kb)] shrink-0">→</span>
              <span className="font-semibold text-gray-800 truncate">{r.b}</span>
            </div>
            <span className="text-[10px] text-gray-500 w-16 text-right shrink-0">신뢰 {(r.confidence * 100).toFixed(0)}%</span>
            <span className="text-[10px] font-bold w-14 text-right shrink-0 tabular-nums" style={{ color: r.lift >= 1 ? "var(--kb)" : "#9ca3af" }} title="lift>1 = 우연보다 자주 함께 구매">lift {r.lift.toFixed(1)}</span>
            <span className="text-[10px] text-gray-400 w-12 text-right shrink-0">{r.count}건</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 전체 시장 대비 분석 (침투율·매장당성과·MBA) */
export function MarketAnalysis({ result }: { result: SalesAnalysisResult }) {
  // 판매매장수가 있을 때만(기존 매출통계). 변형(매장수 없음)이면 침투율·매장당성과 자동 숨김.
  const hasPen = result.penetration?.some((p) => p.storeCount > 0);
  const hasPerStore = result.perStore?.length > 0;
  const hasBasket = result.marketBasket?.length > 0;
  if (!hasPen && !hasPerStore && !hasBasket) return null;

  return (
    <div className="space-y-4">
      {(hasPen || hasPerStore) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {hasPen && <PenetrationSection items={result.penetration} />}
          {hasPerStore && <PerStoreSection items={result.perStore} />}
        </div>
      )}
      {hasBasket && <BasketSection rules={result.marketBasket} />}
    </div>
  );
}
