"use client";
/**
 * 브라우저 확장 프로그램(MetaMask 등)이 페이지에 주입한 스크립트에서 던지는 오류를 삼킨다.
 * 확장은 사용자 브라우저 사정이라 앱이 고칠 수 없는데, Next dev 오버레이/콘솔에는 앱 오류처럼 보인다.
 * 오류 출처가 확장 URL일 때만 차단하며, 앱 자신의 오류는 절대 건드리지 않는다.
 */
import { useEffect } from "react";

const EXT_SRC = /(chrome|moz|safari-web)-extension:\/\//;

function fromExtension(stackLike: unknown, filename?: string): boolean {
  if (filename && EXT_SRC.test(filename)) return true;
  const stack = (stackLike as { stack?: unknown } | null | undefined)?.stack;
  return typeof stack === "string" && EXT_SRC.test(stack);
}

export function ExtensionErrorGuard() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (!fromExtension(e.error, e.filename)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (!fromExtension(e.reason)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
    };
  }, []);
  return null;
}

export default ExtensionErrorGuard;
