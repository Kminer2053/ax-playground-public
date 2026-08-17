import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * 한글 등 IME 조합 중(또는 조합 확정 직전)인 Enter는 `onKeyDown`에서
 * 전송/검색과 함께 처리하면 마지막 글자가 입력창에 남는 경우가 있다.
 * 이 경우 true → 전송/검색을 실행하지 않는다.
 */
export function isEnterBlockedByIme(e: ReactKeyboardEvent<HTMLElement>): boolean {
  if (e.repeat) return true;
  const n = e.nativeEvent;
  if (n.isComposing) return true;
  /** Chromium 등: IME 처리 중 */
  if (n.keyCode === 229) return true;
  return false;
}

/**
 * 단일 줄 input에서 Enter로 전송·검색할 때 사용.
 * IME 조합 중이면 무시하고, 그 외에는 `preventDefault` 후 실행.
 */
export function runOnEnterKeySubmit(e: ReactKeyboardEvent<HTMLElement>, fn: () => void): void {
  if (e.key !== "Enter") return;
  if (isEnterBlockedByIme(e)) return;
  e.preventDefault();
  fn();
}

/**
 * `<form>`에 `onKeyDownCapture={preventImeEnterFormSubmit}` 등으로 연결.
 * IME 조합 중 Enter로 submit 되는 것만 막음 (textarea는 제외).
 */
export function preventImeEnterFormSubmit(e: ReactKeyboardEvent<HTMLFormElement>): void {
  if (e.key !== "Enter") return;
  const t = e.target;
  if (t instanceof HTMLTextAreaElement) return;
  if (t instanceof HTMLInputElement && isEnterBlockedByIme(e)) {
    e.preventDefault();
  }
}
