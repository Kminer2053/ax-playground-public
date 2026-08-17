import type { ReactNode } from "react";
import { PanelBackToMain } from "@/components/panel/PanelBackToMain";

// 스탠드얼론 풀스크린 패널 프레임 — 상단 헤더(픽토그램+제목 가운데 정렬 / ← 메인 좌측) + 본문 영역.
// 톤 B(AI 리서치매거진 헤더 기준). 본문은 flex-1 로 화면을 꽉 채우며, 내부 스크롤은 children 이 관리.
type PanelShellProps = {
  title: string;
  /** 머티리얼 심볼 아이콘 이름(픽토그램). */
  icon?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  children: ReactNode;
  /** 본문(main) 영역 클래스 — 보통 좌우분할 grid 등 */
  bodyClassName?: string;
};

export function PanelShell({
  title,
  icon,
  subtitle,
  actions,
  backHref = "/",
  children,
  bodyClassName = "",
}: PanelShellProps) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--ax-page)]">
      <header className="relative flex shrink-0 items-center justify-center border-b border-[var(--ax-border-soft)] bg-white px-5 py-3">
        <PanelBackToMain href={backHref} className="absolute left-5 text-[var(--ax-text-muted)] hover:text-[var(--ax-accent)]" />
        <h1 className="flex items-center gap-2 text-lg font-extrabold text-[var(--ax-accent)]">
          {icon && <span className="material-symbols-outlined text-[22px] leading-none">{icon}</span>}
          {title}
          {subtitle != null && <span className="ml-1 text-xs font-normal text-[var(--ax-text-hint)]">{subtitle}</span>}
        </h1>
        {actions != null && <div className="absolute right-5 flex items-center gap-2">{actions}</div>}
      </header>
      <main className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</main>
    </div>
  );
}
