import type { Metadata } from "next";
import "./globals.css";
import { ExtensionErrorGuard } from "@/components/ExtensionErrorGuard";
import { OrgProvider } from "@/components/OrgProvider";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";

export const metadata: Metadata = {
  title: "AX Playground",
  description: "AX Playground — 폐쇄망에서 도는 생성형 AI 업무 플랫폼, AI로 업무를 더 쉽고 재미있게",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 기관명은 관리자 설정(DB)에서 — 실패 시 기본값 폴백(getPlaygroundConfig 내장).
  const { orgName } = await getPlaygroundConfig();
  return (
    <html lang="ko">
      {/* 폐쇄망 전용: 외부 폰트 CDN 미사용(시스템 한글 폰트 사용). 데스크톱 전용(min-width). */}
      <body className="antialiased min-w-[1280px]">
        <ExtensionErrorGuard />
        <OrgProvider orgName={orgName}>{children}</OrgProvider>
      </body>
    </html>
  );
}
