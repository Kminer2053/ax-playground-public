"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { GuardrailDashboardClient } from "@/app/admin/guardrails/GuardrailDashboardClient";
import { UsageTab } from "./tabs/UsageTab";
import { QuizManageTab } from "./tabs/QuizManageTab";
import { LibraryManageTab } from "./tabs/LibraryManageTab";
import { DataManageTab } from "./tabs/DataManageTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { DocTemplateTab } from "./tabs/DocTemplateTab";
import SearchFeedbackTab from "./tabs/SearchFeedbackTab";
import { RegulationsTab } from "./tabs/RegulationsTab";

type TabKey = "usage" | "guardrails" | "feedback" | "quiz" | "library" | "regs" | "data" | "doctpl" | "settings";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "usage", label: "사용통계", icon: "monitoring" },
  { key: "guardrails", label: "가드레일", icon: "shield" },
  { key: "feedback", label: "AI답변품질", icon: "rate_review" },
  { key: "quiz", label: "퀴즈 관리", icon: "quiz" },
  { key: "library", label: "라이브러리 관리", icon: "menu_book" },
  { key: "regs", label: "사규", icon: "gavel" },
  { key: "data", label: "광고심의 기준", icon: "database" },
  { key: "doctpl", label: "문서양식", icon: "description" },
  { key: "settings", label: "설정", icon: "settings" },
];

/** ?tab= 초기값 (구 /admin/guardrails redirect 대응). */
function useInitialTab(): TabKey {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      return (TABS.some((x) => x.key === t) ? t : "usage") as TabKey;
    },
    () => "usage" as TabKey,
  );
}

export function AdminDashboard() {
  const initial = useInitialTab();
  const [tab, setTab] = useState<TabKey>(initial);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-gradient-to-b from-[var(--ax-accent-bg)] to-[var(--ax-page)]">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-6 py-6">
        {/* 헤더 */}
        <div className="mb-4 flex items-center gap-2 text-sm text-[var(--ax-text-hint)]">
          <Link href="/" className="hover:text-[var(--ax-accent)]">메인</Link>
          <span>/</span>
          <span className="text-[var(--ax-text-muted)]">관리자</span>
        </div>
        <h1 className="mb-5 flex items-center gap-2 text-2xl font-black text-[var(--ax-text)]">
          <span className="material-symbols-outlined text-[var(--ax-accent)]">admin_panel_settings</span>
          AX Playground 관리자
        </h1>

        {/* 탭 네비 */}
        <div className="mb-6 flex flex-wrap gap-1 border-b border-[var(--ax-border)]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-bold transition ${
                tab === t.key ? "border-[var(--ax-accent)] text-[var(--ax-accent)]" : "border-transparent text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* 탭 컨텐츠 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "usage" && <UsageTab />}
          {tab === "guardrails" && <GuardrailDashboardClient />}
          {tab === "feedback" && <SearchFeedbackTab />}
          {tab === "quiz" && <QuizManageTab />}
          {tab === "library" && <LibraryManageTab />}
          {tab === "regs" && <RegulationsTab />}
          {tab === "data" && <DataManageTab />}
          {tab === "doctpl" && <DocTemplateTab />}
          {tab === "settings" && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}
