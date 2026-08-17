import type { ReactNode } from "react";
import { PanelBackToMain } from "@/components/panel/PanelBackToMain";

/**
 * 전 패널 공통 상단 헤더 — AI 리서치매거진 기준.
 * 뒤로가기(좌) + 픽토그램+타이틀명(가운데 정렬) + 우측 여백/슬롯.
 * right를 넘기면 우측에 배치되며, 가운데 정렬을 위해 좌측 뒤로가기와 균형이 맞도록 폭을 비슷하게 유지할 것.
 */
export function PanelHeader({ icon, title, right, backHref }: { icon: string; title: string; right?: ReactNode; backHref?: string }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-2">
      <PanelBackToMain href={backHref} className="text-[var(--ax-text-muted)] hover:text-[var(--ax-accent)]" />
      <h1 className="flex items-center gap-2 text-lg font-extrabold text-[var(--ax-accent)]">
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
        {title}
      </h1>
      {right ?? <div className="w-12" />}
    </div>
  );
}
