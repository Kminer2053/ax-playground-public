"use client";

/**
 * 상품 분석 이하 섹션을 탭으로 묶음 — 화면이 길어 자동 표출은 매출분석까지만,
 * 그 이후는 사용자가 탭을 눌러 확인. 각 탭마다 '출력' 버튼(탭 내용만 1장 인쇄).
 */
import { useState } from "react";
import { MarketAnalysis } from "./MarketAnalysis";
import { MarketShift } from "./MarketShift";
import { AbcRanking } from "./AbcRanking";
import type { SalesAnalysisResult } from "@/lib/salesAnalysis";

function fmt(n: number) { return n.toLocaleString("ko-KR"); }
function fmtWon(n: number) {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억원`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}만원`;
  return `${fmt(n)}원`;
}
function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

export function SalesTabs({ result }: { result: SalesAnalysisResult }) {
  const opportunityItems = result.abcRanking.filter((p) => p.grade === "C" && p.allRank !== null && p.allRank <= 30);
  const dangerItems = result.inventoryAlerts.filter((a) => a.status === "danger");
  const warnItems = result.inventoryAlerts.filter((a) => a.status === "warn");
  const hasMarket =
    result.penetration.some((p) => p.storeCount > 0) || result.perStore.length > 0 || result.marketBasket.length > 0 ||
    result.byBonbu.length > 0 || result.byVendor.length > 0 || result.byContract.length > 0 || result.pb != null;
  const hasInv = dangerItems.length > 0 || warnItems.length > 0;

  const tabs: { key: string; label: string }[] = [
    { key: "category", label: "카테고리·기회" },
    ...(hasMarket ? [{ key: "market", label: "시장·확장 분석" }] : []),
    { key: "lost", label: "놓친매출·벤치마킹" },
    ...(result.trendProducts.length ? [{ key: "trend", label: "트렌드 상품" }] : []),
    { key: "abc", label: "ABC 분석" },
    ...(hasInv ? [{ key: "inventory", label: "재고 경보" }] : []),
  ];
  const [tab, setTab] = useState<string>(tabs[0]?.key ?? "category");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pt-1 no-print">
        <span className="text-base font-extrabold text-gray-800">📦 상품 분석</span>
        <span className="text-[11px] text-gray-400">탭을 눌러 항목별로 확인 · 각 탭은 따로 출력됩니다</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 no-print">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${tab === t.key ? "bg-[var(--kb)] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto px-3 py-1.5 rounded-full text-xs font-semibold border border-[var(--kb)] text-[var(--kb)] hover:bg-[var(--kb)] hover:text-white"
        >
          🖨 이 항목 출력
        </button>
      </div>

      <div className="sales-print-area space-y-4">
        {/* 카테고리 + 기회 상품 */}
        {tab === "category" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
              <div className="border-l-4 border-[var(--kb)] pl-2.5 mb-3">
                <div className="text-[15px] font-bold text-gray-800">카테고리 강약점</div>
                <div className="text-[11px] text-gray-400">우리 매장 vs 전체 평균 비중</div>
              </div>
              <div className="space-y-2">
                {result.categoryPortfolio.slice(0, 6).map((cat, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-600 w-20 shrink-0 truncate">{cat.category || "기타"}</span>
                    <div className="flex-1 flex items-center gap-1">
                      <div className="flex-1 h-3 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full rounded transition-all" style={{ width: `${Math.min(cat.ourShare * 200, 100)}%`, background: cat.gap >= 0 ? "var(--kb)" : "var(--kr)" }} />
                      </div>
                      <span className="text-[10px] font-bold w-10 text-right" style={{ color: cat.gap >= 0 ? "var(--kb)" : "var(--kr)" }}>
                        {cat.gap >= 0 ? "+" : ""}{pct(cat.gap)}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-400 w-14 text-right">{pct(cat.ourShare)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
              <div className="border-l-4 border-[var(--kr)] pl-2.5 mb-3">
                <div className="text-[15px] font-bold text-gray-800">놓친 기회 상품</div>
                <div className="text-[11px] text-gray-400">전체 상위 30위 내 · 우리 매장 C등급</div>
              </div>
              {opportunityItems.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">기회 상품 없음</p>
              ) : (
                <div className="space-y-2">
                  {opportunityItems.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                      <div>
                        <span className="inline-block bg-red-50 text-[var(--kr)] text-[9px] font-bold px-1.5 py-0.5 rounded mr-1">전체{p.allRank}위</span>
                        <span className="text-xs font-bold text-gray-800">{p.productName}</span>
                      </div>
                      <span className="text-[11px] text-gray-500">{fmtWon(p.totalAmount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 시장·확장 분석 */}
        {tab === "market" && (
          <>
            <MarketAnalysis result={result} />
            <MarketShift result={result} />
          </>
        )}

        {/* 놓친 매출 + 벤치마킹 */}
        {tab === "lost" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-[var(--kr)]">
              <div className="flex justify-between items-start mb-2">
                <div className="text-[15px] font-bold text-gray-800">
                  💸 분석 기간 놓친 매출
                  <span className="text-[10px] font-normal text-gray-400 ml-1.5">{result.period.days}일 추정</span>
                </div>
                <div className="text-xl font-black text-[var(--kr)]">-{fmtWon(result.lostRevenue.total)}</div>
              </div>
              <p className="text-xs text-gray-500 mb-3">전체 매장 평균 비중으로 팔았다면 추가로 벌 수 있었던 금액입니다.</p>
              <div className="space-y-2">
                {result.lostRevenue.items.map((r, i) => (
                  <div key={i} className={`rounded-lg p-3 flex justify-between items-center ${r.isPositive ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                    <div>
                      <div className="text-[13px] font-bold">{r.category}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        우리 {pct(r.ourShare)} vs 평균 {pct(r.allShare)} —{" "}
                        <b style={{ color: r.isPositive ? "var(--kg)" : "var(--kr)" }}>
                          {Math.abs(r.gap * 100).toFixed(1)}%p {r.isPositive ? "우위" : "부족"}
                        </b>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-black" style={{ color: r.isPositive ? "var(--kg)" : "var(--kr)" }}>
                        {r.isPositive ? "+" : "-"}{fmtWon(Math.abs(r.amount))}
                      </div>
                      <div className="text-[10px] text-gray-400">{r.isPositive ? "초과 수익" : "손실"} 추정</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
              <div className="border-l-4 border-[var(--kc)] pl-2.5 mb-3">
                <div className="text-[15px] font-bold text-gray-800">유사 매장 벤치마킹</div>
                <div className="text-[11px] text-gray-400">우리 매장 vs 비교 매장 일평균 매출</div>
              </div>
              {!result.benchmark ? (
                <p className="text-sm text-gray-400 py-6 text-center">비교 매장을 추가하면 표시됩니다.</p>
              ) : (
                <div className="space-y-3">
                  {[
                    { name: result.benchmark.ourName, val: result.benchmark.ourDailyAvg, isUs: true, rank: result.benchmark.ourRank },
                    { name: result.benchmark.compareName, val: result.benchmark.compareDailyAvg, isUs: false, rank: result.benchmark.ourRank === 1 ? 2 : 1 },
                  ].sort((a, b) => a.rank - b.rank).map((b, i) => {
                    const maxVal = Math.max(result.benchmark!.ourDailyAvg, result.benchmark!.compareDailyAvg) || 1;
                    return (
                      <div key={i} className={`rounded-lg p-3 ${b.isUs ? "bg-blue-50 border border-blue-200" : "bg-gray-50 border border-gray-200"}`}>
                        <div className="flex justify-between items-center mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${b.rank === 1 ? "bg-[var(--kr)]" : "bg-gray-500"}`}>{b.rank}</span>
                            <b className={`text-xs ${b.isUs ? "text-[var(--kb)]" : "text-gray-700"}`}>{b.name}{b.isUs && " (우리)"}</b>
                          </div>
                          <span className={`text-sm font-black ${b.isUs ? "text-[var(--kb)]" : "text-gray-600"}`}>{fmtWon(b.val)}</span>
                        </div>
                        <div className="h-2 bg-white rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(b.val / maxVal) * 100}%`, background: b.isUs ? "var(--kb)" : "#9ca3af" }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className="text-center pt-1 text-xs font-semibold" style={{ color: result.benchmark.diffPct >= 0 ? "var(--kb)" : "var(--kr)" }}>
                    비교 매장 대비 {result.benchmark.diffPct >= 0 ? "+" : ""}{pct(result.benchmark.diffPct)} {result.benchmark.diffPct >= 0 ? "우위" : "열위"}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 트렌드 상품 비교 */}
        {tab === "trend" && result.trendProducts.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
            <div className="border-l-4 border-[var(--kc)] pl-2.5 mb-3">
              <div className="text-[15px] font-bold text-gray-800">트렌드 상품 비교</div>
              <div className="text-[11px] text-gray-400">카테고리별 Top 상품 — 우리 매장 vs {result.compareStoreName || "비교 매장"}</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {result.trendProducts.map((t, i) => {
                const maxV = Math.max(t.ourDailyAvg, t.compareDailyAvg) || 1;
                return (
                  <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="text-xs text-gray-500 text-center mb-2 font-medium">{t.category}</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 text-center">
                        <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full mb-1 ${t.weWin ? "text-white bg-[var(--kr)]" : "invisible"}`}>우리 WIN</span>
                        <span className="block text-[11px] font-bold mb-1 truncate" title={t.ourName}>{t.ourName}</span>
                        <div className="w-full h-2 bg-gray-200 rounded overflow-hidden">
                          <div className="h-full rounded bg-[var(--kb)]" style={{ width: `${(t.ourDailyAvg / maxV) * 100}%` }} />
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">일 {fmtWon(t.ourDailyAvg)}</div>
                      </div>
                      <div className="font-black text-gray-400 text-[11px]">VS</div>
                      <div className="flex-1 text-center">
                        <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full mb-1 ${!t.weWin ? "text-white bg-gray-500" : "invisible"}`}>비교 WIN</span>
                        <span className="block text-[11px] font-bold mb-1 truncate" title={t.compareName}>{t.compareName}</span>
                        <div className="w-full h-2 bg-gray-200 rounded overflow-hidden">
                          <div className="h-full rounded bg-gray-400" style={{ width: `${(t.compareDailyAvg / maxV) * 100}%` }} />
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">일 {fmtWon(t.compareDailyAvg)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 상품 ABC */}
        {tab === "abc" && <AbcRanking result={result} />}

        {/* 재고 경보 */}
        {tab === "inventory" && hasInv && (
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 overflow-x-auto">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <div className="border-l-4 border-[var(--kr)] pl-2.5 text-[15px] font-bold text-gray-800">재고 경보</div>
              <div className="flex gap-2">
                {dangerItems.length > 0 && <span className="px-2 py-1 rounded text-[10px] font-bold bg-red-50 text-[var(--kr)]">긴급 {dangerItems.length}</span>}
                {warnItems.length > 0 && <span className="px-2 py-1 rounded text-[10px] font-bold bg-amber-50 text-[var(--ky)]">주의 {warnItems.length}</span>}
              </div>
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {["상품명", "현재고", "일평균 판매", "예상 소진", "상태"].map((h) => (
                    <th key={h} className="bg-gray-100 text-gray-600 py-2 px-2 text-center font-bold border-b-2 border-gray-200 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...dangerItems, ...warnItems].map((item, i) => {
                  const isDanger = item.status === "danger";
                  return (
                    <tr key={i} className={`${isDanger ? "bg-red-50" : "bg-amber-50"} border-b border-gray-100`}>
                      <td className="py-2 px-2 font-bold">{item.productName}</td>
                      <td className="py-2 px-2 text-center font-bold">{item.stock}</td>
                      <td className="py-2 px-2 text-center">{item.dailySale.toFixed(1)}</td>
                      <td className="py-2 px-2 text-center font-bold" style={{ color: isDanger ? "var(--kr)" : "var(--ky)" }}>
                        {item.exhaustDays !== null ? `${item.exhaustDays.toFixed(1)}일` : "즉시 소진"}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${isDanger ? "bg-red-100 text-[var(--kr)]" : "bg-amber-100 text-[var(--ky)]"}`}>
                          {isDanger ? "긴급" : "주의"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
