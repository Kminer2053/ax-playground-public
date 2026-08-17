"use client";

/**
 * 사규 — 적재·현황·목록편집을 한 탭에서.
 *
 * 원래 「사규 적재」·「기준데이터>사규」·「지식자산」 세 탭에 흩어져 있었다. 대상이 같은데
 * 화면이 갈라져 있으면 "올린 뒤 무엇이 어떻게 됐나"를 확인하려고 탭을 옮겨다녀야 한다.
 * 적재 → 현황 확인이 한 자리에서 이어지도록 묶었다.
 */

import { useState } from "react";
import AssetStatusTab from "./AssetStatusTab";
import { RegulationIngestTab } from "./RegulationIngestTab";
import { RegulationListPanel } from "./RegulationListPanel";
import { OntologyReviewPanel } from "./OntologyReviewPanel";

const SUBS = [
  { key: "status", label: "현황", hint: "파이프라인 상태·조치 필요" },
  { key: "ingest", label: "적재", hint: "파일 업로드 → 추출·검수 → 반영" },
  { key: "list", label: "목록·편집", hint: "원본 없이 조문 직접 수정" },
  { key: "review", label: "근거 재검토", hint: "개정으로 격리된 업무 근거 조치" },
] as const;
type SubKey = (typeof SUBS)[number]["key"];

export function RegulationsTab() {
  const [sub, setSub] = useState<SubKey>("status");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {SUBS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            title={s.hint}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
              sub === s.key ? "bg-[var(--ax-accent)] text-white" : "bg-[var(--ax-border-soft)] text-[var(--ax-text-muted)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sub === "status" && <AssetStatusTab />}
      {sub === "ingest" && <RegulationIngestTab />}
      {sub === "list" && <RegulationListPanel />}
      {sub === "review" && <OntologyReviewPanel />}
    </div>
  );
}
