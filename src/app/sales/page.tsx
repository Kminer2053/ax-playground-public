"use client";

import Link from "next/link";
import { useState } from "react";

export default function SalesPage() {
  const [store, setStore] = useState("○○역 매장 A");
  const [period, setPeriod] = useState("7");
  const [data, setData] = useState<{ kpi: { dailySales: number; visitors: number; avgOrder: number; turnoverDays: number }; aiDiagnosis: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/sales/diagnosis?store=${encodeURIComponent(store)}&period=${period}`, { credentials: "include" });
      const json = await res.json();
      if (json.ok) setData(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-gray-500 hover:text-[var(--brand-blue)]">대시보드</Link>
        <Link href="/panel/sales" className="text-sm text-gray-500 hover:text-[var(--brand-blue)]">매출 패널(목업)</Link>
      </div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <span className="material-symbols-outlined text-[var(--brand-blue)]">monitoring</span>매출 분석 (실제 조회)
      </h1>
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">매장</label>
            <select value={store} onChange={(e) => setStore(e.target.value)} className="px-4 py-2 rounded-xl border border-gray-200">
              <option>○○역 매장 A</option>
              <option>○○역 매장 B</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">기간</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="px-4 py-2 rounded-xl border border-gray-200">
              <option value="7">최근 7일</option>
              <option value="30">최근 30일</option>
            </select>
          </div>
          <button onClick={handleSearch} disabled={loading} className="bg-[var(--brand-blue)] text-white font-semibold px-6 py-2 rounded-xl disabled:opacity-50">조회</button>
        </div>
        {data && (
          <div className="mt-6 pt-6 border-t border-gray-100 space-y-4">
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
              <div className="font-bold text-[var(--brand-blue)] mb-1">AI 점포 진단</div>
              <p className="text-gray-700">{data.aiDiagnosis}</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-gray-50">
                <div className="text-xs text-gray-500">일 평균 매출</div>
                <div className="font-bold text-gray-900">{data.kpi.dailySales.toLocaleString()}원</div>
              </div>
              <div className="p-4 rounded-xl bg-gray-50">
                <div className="text-xs text-gray-500">방문객수</div>
                <div className="font-bold text-gray-900">{data.kpi.visitors}명</div>
              </div>
              <div className="p-4 rounded-xl bg-gray-50">
                <div className="text-xs text-gray-500">객단가</div>
                <div className="font-bold text-gray-900">{data.kpi.avgOrder.toLocaleString()}원</div>
              </div>
              <div className="p-4 rounded-xl bg-gray-50">
                <div className="text-xs text-gray-500">재고 회전</div>
                <div className="font-bold text-gray-900">{data.kpi.turnoverDays}일</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
