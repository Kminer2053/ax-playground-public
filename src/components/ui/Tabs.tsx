import type { ReactNode } from "react";

// 제어형 탭 바 — active/onChange 를 부모가 관리(워크플로 단계에 따라 자동 포커스 가능).
export type TabItem = { key: string; label: ReactNode; icon?: ReactNode; disabled?: boolean };

export function Tabs({
  items,
  active,
  onChange,
  className = "",
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex flex-wrap gap-0.5 border-b border-[var(--ax-border-soft)] px-2 ${className}`}
    >
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={on}
            disabled={it.disabled}
            onClick={() => onChange(it.key)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
              on
                ? "border-[var(--ax-accent)] font-medium text-[var(--ax-accent)]"
                : "border-transparent text-[var(--ax-text-muted)] hover:text-[var(--ax-text)]"
            }`}
          >
            {it.icon != null && <span className="text-[1.05em] leading-none">{it.icon}</span>}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
