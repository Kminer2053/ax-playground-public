import type { ReactNode } from "react";

// 톤 B 카드 — 흰 표면, 보더, 라운드. 선택적 라벨/우측 액션 헤더.
type CardProps = {
  label?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function Card({ label, action, children, className = "", bodyClassName = "" }: CardProps) {
  return (
    <div
      className={`rounded-[var(--ax-radius)] border border-[var(--ax-border)] bg-[var(--ax-card)] p-3 ${className}`}
    >
      {(label != null || action != null) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {label != null && (
            <span className="text-xs font-medium text-[var(--ax-text-muted)]">{label}</span>
          )}
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
