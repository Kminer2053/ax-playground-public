"use client";

import { PanelHeader } from "@/components/panel/PanelHeader";

/**
 * AI 리서치매거진 (P9) — 리서치 의뢰 안내 정적 패널.
 * 폐쇄망 배포 환경에서는 외부 URL 접속이 불가하므로 클릭 링크는 두지 않고,
 * 소개·이용 4단계·주요 기능만 텍스트로 안내한다.
 */
const STEPS: { step: string; title: string; desc: string }[] = [
  { step: "1", title: "주제 한 줄 요청", desc: "알고 싶은 주제를 한 문장으로 남깁니다. 배경·활용처를 덧붙이면 결과가 더 정확해집니다." },
  { step: "2", title: "자료 조사·정리", desc: "요청 주제에 맞춰 자료를 모으고 쟁점별로 구조화합니다." },
  { step: "3", title: "시각화·요약", desc: "핵심 수치와 흐름을 도표·요약으로 정리해 한눈에 볼 수 있게 만듭니다." },
  { step: "4", title: "결과 회신", desc: "정리된 리포트를 문서로 받아 그대로 보고·공유에 활용합니다." },
];

const FEATURES: string[] = [
  "주제별 자료 조사 및 쟁점 정리",
  "핵심 수치·추세 시각화",
  "보고용 요약본 작성",
  "관련 자료 출처 목록 정리",
];

export function PanelMagazine() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[var(--ax-accent-bg)] to-[var(--ax-page)]">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <PanelHeader icon="menu_book" title="AI 리서치매거진" />

        <div className="rounded-[var(--ax-radius-lg)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-8 shadow-sm">
          <h2 className="text-xl font-black text-[var(--ax-text)]">리서치가 필요한 사항은 무엇이든 요청해 주세요</h2>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-[var(--ax-text-muted)]">
            한 줄만 던지면 조사·정리·시각화까지 진행해 보고에 바로 쓸 수 있는 형태로 돌려드립니다.
            업무 중 확인이 필요한 시장 동향, 사례 조사, 제도 비교 등 주제 제한 없이 의뢰할 수 있습니다.
          </p>

          <div className="mt-7">
            <div className="text-xs font-bold tracking-wide text-[var(--ax-text-hint)]">이용 4단계</div>
            <ol className="mt-3 grid gap-3 sm:grid-cols-2">
              {STEPS.map((s) => (
                <li key={s.step} className="flex gap-3 rounded-[var(--ax-radius)] border border-[var(--ax-border-soft)] bg-[var(--ax-page)] p-4">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--ax-accent-bg)] text-sm font-black text-[var(--ax-accent)]">
                    {s.step}
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-[var(--ax-text)]">{s.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--ax-text-muted)]">{s.desc}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-7">
            <div className="text-xs font-bold tracking-wide text-[var(--ax-text-hint)]">주요 기능</div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {FEATURES.map((f) => (
                <li key={f} className="rounded-full border border-[var(--ax-border-soft)] bg-[var(--ax-page)] px-3 py-1.5 text-[13px] text-[var(--ax-text-muted)]">
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-7 rounded-[var(--ax-radius)] bg-[var(--ax-border-soft)] px-4 py-3 text-[13px] leading-relaxed text-[var(--ax-text-muted)]">
            폐쇄망 환경에서는 외부 접속이 제한되므로, 의뢰는 사내 담당 부서를 통해 접수합니다.
          </p>
        </div>
      </div>
    </div>
  );
}
