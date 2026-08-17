type LlmSpinnerProps = {
  className?: string;
  /** 상단 강조색 (border-t) */
  accentClass?: string;
};

export function LlmSpinner({ className = "w-4 h-4", accentClass = "border-t-[#136dec]" }: LlmSpinnerProps) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full border-2 border-slate-200 ${accentClass} animate-spin ${className}`}
      role="status"
      aria-label="로딩 중"
    />
  );
}
