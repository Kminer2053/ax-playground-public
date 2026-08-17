"use client";

/** 광고심의 기준 — 업종별 룰셋 + 공통 심의기준. 사규는 「사규」 탭으로 옮겼다. */

import { useCallback, useEffect, useState } from "react";

type Rule = { _id: string; industry: string; category: string; highRisk: boolean; banned: boolean };
export function DataManageTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [criteriaText, setCriteriaText] = useState("");
  const [prohibited, setProhibited] = useState("");
  const [loading, setLoading] = useState(true);
  const [savedMsg, setSavedMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rd, cd] = await Promise.all([
        fetch("/api/admin/ad-rules").then((r) => r.json()),
        fetch("/api/admin/ad-criteria").then((r) => r.json()),
      ]);
      setRules(rd.rules || []);
      setCriteriaText(cd.criteriaText ?? cd.criteria?.criteriaText ?? "");
      setProhibited((cd.prohibitedList ?? cd.criteria?.prohibitedList ?? []).join("\n"));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const delRule = async (id: string) => {
    if (!window.confirm("이 업종 룰을 삭제할까요?")) return;
    await fetch(`/api/admin/ad-rules/${id}`, { method: "DELETE" });
    void load();
  };
  const saveCriteria = async () => {
    const r = await fetch("/api/admin/ad-criteria", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ criteriaText, prohibitedList: prohibited.split("\n").map((s) => s.trim()).filter(Boolean) }),
    });
    if (r.ok) { setSavedMsg("저장됨 ✓ (30초 내 심의에 반영)"); setTimeout(() => setSavedMsg(""), 2500); }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--ax-border)] bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-bold text-[var(--ax-text)]">심의기준 · 금지광고 목록</div>
        <label className="text-xs text-[var(--ax-text-muted)]">심의기준 요약</label>
        <textarea value={criteriaText} onChange={(e) => setCriteriaText(e.target.value)} rows={5} className="mb-3 mt-1 w-full rounded-lg border border-[var(--ax-border)] p-2 text-xs" />
        <label className="text-xs text-[var(--ax-text-muted)]">금지광고 목록 (줄당 1개)</label>
        <textarea value={prohibited} onChange={(e) => setProhibited(e.target.value)} rows={4} className="mb-3 mt-1 w-full rounded-lg border border-[var(--ax-border)] p-2 text-xs" />
        <div className="flex items-center gap-3">
          <button onClick={saveCriteria} className="rounded-lg bg-[var(--ax-accent)] px-4 py-2 text-sm font-bold text-white">저장</button>
          {savedMsg && <span className="text-xs text-[var(--ax-success)]">{savedMsg}</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--ax-border)] bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-bold text-[var(--ax-text)]">업종 룰셋 ({rules.length})</div>
        {loading ? <div className="py-8 text-center text-sm text-[var(--ax-text-hint)]">불러오는 중…</div> : (
          <div className="max-h-[360px] space-y-1.5 overflow-y-auto">
            {rules.map((r) => (
              <div key={r._id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--ax-border)] p-2.5">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-[var(--ax-text)]">{r.industry}</span>
                  <span className="ml-2 text-xs text-[var(--ax-text-hint)]">{r.category}</span>
                  {r.banned && <span className="ml-2 rounded bg-[var(--ax-danger-bg)] px-1.5 py-0.5 text-[10px] text-[var(--ax-danger)]">금지</span>}
                  {r.highRisk && !r.banned && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">고위험</span>}
                </div>
                <button onClick={() => delRule(r._id)} className="material-symbols-outlined flex-none rounded-lg px-2 py-1 text-[18px] text-[var(--ax-text-muted)] hover:bg-[var(--ax-danger-bg)] hover:text-[var(--ax-danger)]" title="삭제">delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
