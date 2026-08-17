import type { ReactNode } from "react";
import { LlmSpinner } from "@/components/llm/LlmSpinner";

// 공통 상태 표시 — 로딩/에러/빈/성공. 로딩은 기존 LlmSpinner 재사용(강조색만 톤 B).
type StatusKind = "loading" | "error" | "empty" | "success";

export function StatusBox({
  kind,
  children,
  className = "",
}: {
  kind: StatusKind;
  children?: ReactNode;
  className?: string;
}) {
  if (kind === "error") {
    return (
      <div
        className={`rounded-[var(--ax-radius)] border border-[var(--ax-danger)] bg-[var(--ax-danger-bg)] px-3 py-2 text-sm text-[var(--ax-danger)] ${className}`}
      >
        {children}
      </div>
    );
  }
  if (kind === "success") {
    return (
      <div
        className={`rounded-[var(--ax-radius)] border border-[var(--ax-success)] bg-[var(--ax-success-bg)] px-3 py-2 text-sm text-[var(--ax-success)] ${className}`}
      >
        {children}
      </div>
    );
  }
  if (kind === "empty") {
    return (
      <div
        className={`flex min-h-20 items-center justify-center text-sm text-[var(--ax-text-hint)] ${className}`}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={`flex min-h-20 items-center justify-center gap-2 text-sm text-[var(--ax-text-muted)] ${className}`}
    >
      <LlmSpinner accentClass="border-t-[var(--ax-accent)]" />
      {children}
    </div>
  );
}
