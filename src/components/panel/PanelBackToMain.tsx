"use client";

import Link from "next/link";

type Props = { href?: string; className?: string };

/**
 * 패널 최상단 헤더 내에 배치하는 ← 링크. floating 아님.
 */
export function PanelBackToMain({ href = "/", className = "" }: Props) {
  return (
    <Link
      href={href}
      className={`text-lg font-semibold hover:opacity-80 transition-opacity ${className}`}
      aria-label="메인으로 돌아가기"
    >
      ←
    </Link>
  );
}
