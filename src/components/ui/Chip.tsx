import type { ReactNode } from "react";

// 선택형 칩(큰 버튼형) — 아이콘(위) + 라벨(아래). 양식 선택 등.
type ChipProps = {
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  className?: string;
};

export function Chip({ active = false, icon, label, onClick, className = "" }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 rounded-[var(--ax-radius-sm)] border px-2 py-2.5 text-center text-xs transition ${
        active
          ? "border-[var(--ax-accent-border)] bg-[var(--ax-accent-soft)] font-medium text-[var(--ax-accent)]"
          : "border-[var(--ax-border)] bg-[var(--ax-card)] text-[var(--ax-text-muted)] hover:border-[var(--ax-accent-border)]"
      } ${className}`}
    >
      {icon != null && (
        <span className={`text-[17px] leading-none ${active ? "" : "opacity-70"}`}>{icon}</span>
      )}
      <span>{label}</span>
    </button>
  );
}
