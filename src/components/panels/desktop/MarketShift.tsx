"use client";

/**
 * 변형(사내 매출시스템 원본형) 데이터 신규 분석 — 본부별 매출 · 공급처별.
 * PB상품·계약구분은 전 매장 공통(전사) 수치라 개별 매장 인사이트로서 의미가 낮아 제외(검수 반영, 2026-06).
 * 데이터(본부/거래처)가 있을 때만 각 섹션 노출(없으면 자동 숨김).
 */
import type { SalesAnalysisResult } from "@/lib/salesAnalysis";

function won(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return `${Math.round(n).toLocaleString("ko-KR")}`;
}
function maxOf(arr: number[]): number {
  return arr.reduce((m, v) => (v > m ? v : m), 0) || 1;
}

function Bar({ label, value, ratio, color, sub }: { label: string; value: string; ratio: number; color: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-700 w-24 shrink-0 truncate" title={label}>{label}</span>
      <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: `${Math.max(2, ratio * 100)}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold text-gray-800 w-16 text-right tabular-nums">{value}</span>
      {sub != null && <span className="text-[10px] text-gray-400 w-12 text-right">{sub}</span>}
    </div>
  );
}

export function MarketShift({ result }: { result: SalesAnalysisResult }) {
  const { byBonbu, byVendor } = result;
  const hasBonbu = byBonbu?.length > 0;
  const hasVendor = byVendor?.length > 0;
  if (!hasBonbu && !hasVendor) return null;

  const bonbuMax = hasBonbu ? maxOf(byBonbu.map((b) => b.amount)) : 1;
  const vendorMax = hasVendor ? maxOf(byVendor.map((v) => v.amount)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pt-1">
        <span className="text-base font-extrabold text-gray-800">🧭 확장 분석</span>
        <span className="text-[11px] text-gray-400">본부별 · 공급처별 매출 (사내 매출시스템 양식 기반) · 단위 천원</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 본부별 매출 */}
        {hasBonbu && (
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="border-l-4 border-[var(--kb)] pl-2.5 mb-3">
              <div className="text-[15px] font-bold text-gray-800">🏢 본부별 매출</div>
              <div className="text-[11px] text-gray-400">전사 매출의 본부 분포</div>
            </div>
            <div className="space-y-1.5">
              {byBonbu.map((b) => (
                <Bar key={b.bonbu} label={b.bonbu} value={won(b.amount)} ratio={b.amount / bonbuMax} color="var(--kb)" sub={`${(b.share * 100).toFixed(0)}%`} />
              ))}
            </div>
          </div>
        )}

        {/* 공급처별 매출 */}
        {hasVendor && (
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="border-l-4 border-[var(--kb)] pl-2.5 mb-3">
              <div className="text-[15px] font-bold text-gray-800">🚚 공급처별 매출 Top</div>
              <div className="text-[11px] text-gray-400">거래처(공급처) 기준 매출</div>
            </div>
            <div className="space-y-1.5">
              {byVendor.slice(0, 10).map((v) => (
                <Bar key={v.vendor} label={v.vendor} value={won(v.amount)} ratio={v.amount / vendorMax} color="var(--kb)" sub={`${v.products}품`} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
