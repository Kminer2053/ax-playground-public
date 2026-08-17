import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

const INPUT_BASE =
  "w-full rounded-[var(--ax-radius-sm)] border border-[var(--ax-border)] bg-white text-sm text-[var(--ax-text)] outline-none transition placeholder:text-[var(--ax-text-hint)] focus:border-[var(--ax-accent-border)] focus:ring-2 focus:ring-[var(--ax-accent-bg)]";

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`text-xs font-medium text-[var(--ax-text-muted)] ${className}`}>{children}</span>
  );
}

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${INPUT_BASE} px-3 py-2 ${className}`} {...rest} />;
}

export function TextArea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${INPUT_BASE} resize-none p-2.5 ${className}`} {...rest} />;
}

// 점선 파일 첨부 영역(클릭/드롭). onFiles 로 선택 파일 전달.
export function FileDrop({
  onFiles,
  accept,
  multiple = false,
  children,
  className = "",
  disabled = false,
}: {
  onFiles: (files: FileList) => void;
  accept?: string;
  multiple?: boolean;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label
      aria-disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-[var(--ax-radius-sm)] border border-dashed px-3 py-3 text-center text-xs transition ${
        disabled
          ? "cursor-not-allowed border-[var(--ax-border)] bg-[var(--ax-border-soft)] text-[var(--ax-text-hint)] opacity-70"
          : "cursor-pointer border-[var(--ax-accent-border)] bg-white text-[var(--ax-text-muted)] hover:bg-[var(--ax-accent-bg)]"
      } ${className}`}
    >
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {children ?? "파일 드래그 · 선택"}
    </label>
  );
}
