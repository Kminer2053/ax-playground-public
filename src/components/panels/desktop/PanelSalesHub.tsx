"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelIntroModal, type IntroTarget } from "@/components/playground/PanelIntroModal";

/** AI 매출분석 허브 — 진입 시 두 분석 도구 중 하나를 메뉴버튼으로 선택. 선택 시 패널 소개 스플래시 후 진입. */
const OPTIONS = [
  {
    id: "sales",
    href: "/panel/sales/compare",
    icon: "storefront",
    color: "#2563eb",
    title: "편의점 매출 비교분석",
    desc: "매장 매출 엑셀을 올리면 KPI·ABC·카테고리·놓친매출·벤치마킹·재고예측과 AI 진단을 제공합니다.",
    tags: ["엑셀 업로드", "매장 비교", "AI 진단"],
  },
  {
    id: "sales-trend",
    href: "/panel/sales/trend",
    icon: "trending_up",
    color: "#0d9488",
    title: "업종별 매출트렌드 분석",
    desc: "업종·기간·역별 매출 흐름을 시각화합니다. 전문점 드릴다운·역간 비교·예측까지.",
    tags: ["업종 트렌드", "역별 비교", "예측"],
  },
];

export function PanelSalesHub() {
  const router = useRouter();
  const [intro, setIntro] = useState<IntroTarget | null>(null);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--ax-page)]">
      <div className="mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 flex-col px-6 py-6">
        <PanelHeader icon="storefront" title="AI 매출분석" />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
          <div className="text-center">
            <h2 className="text-2xl font-extrabold text-[var(--ax-text)] lg:text-3xl">어떤 분석을 시작할까요?</h2>
            <p className="mt-2 text-sm text-[var(--ax-text-muted)]">두 가지 매출 분석 도구 중 하나를 선택하세요.</p>
          </div>
          <div className="grid w-full max-w-3xl gap-5 sm:grid-cols-2">
            {OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setIntro({ id: o.id, label: o.title, color: o.color, href: o.href })}
                className="group relative flex flex-col gap-4 rounded-3xl border bg-[var(--ax-card)] p-7 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ borderColor: `${o.color}29` }}
              >
                <span
                  className="flex h-16 w-16 items-center justify-center rounded-2xl transition group-hover:scale-105"
                  style={{ background: `${o.color}16` }}
                >
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: 38, color: o.color }}>{o.icon}</span>
                </span>
                <div>
                  <h3 className="text-lg font-black" style={{ color: o.color }}>{o.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--ax-text-muted)]">{o.desc}</p>
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5">
                  {o.tags.map((t) => (
                    <span key={t} className="rounded-full bg-[var(--ax-border-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ax-text-muted)]">{t}</span>
                  ))}
                </div>
                <span
                  className="material-symbols-outlined absolute right-6 top-7 transition group-hover:translate-x-1"
                  style={{ color: o.color }}
                >
                  arrow_forward
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {intro && (
        <PanelIntroModal
          target={intro}
          onEnter={() => {
            const href = intro.href;
            setIntro(null);
            router.push(href);
          }}
          onCancel={() => setIntro(null)}
        />
      )}
    </div>
  );
}
