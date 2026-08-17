import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary:
    "text-white bg-[var(--ax-accent)] border-transparent hover:bg-[var(--ax-accent-dark)]",
  outline:
    "text-[var(--ax-accent)] bg-[var(--ax-accent-bg)] border-transparent hover:brightness-95",
  ghost:
    "text-[var(--ax-text-muted)] bg-transparent border-transparent hover:bg-[var(--ax-border-soft)]",
};

const SIZE: Record<Size, string> = {
  sm: "text-xs px-3 py-1.5 rounded-[var(--ax-radius-sm)]",
  md: "text-sm px-4 py-2.5 rounded-[var(--ax-radius)]",
};

type ButtonProps = {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /** 대기 중 — 스피너 표시 + 비활성화 */
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-1.5 border font-medium transition ${
        loading ? "cursor-wait" : "disabled:cursor-not-allowed disabled:opacity-50"
      } ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        // 글자색(currentColor)을 링 색으로 쓰고 위쪽만 투명 → 어떤 배경에서도 회전이 또렷.
        <span
          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : (
        icon != null && <span className="text-[1.1em] leading-none">{icon}</span>
      )}
      {children}
    </button>
  );
}
