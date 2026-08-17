"use client";

import { createContext, useContext } from "react";

/** 기관명 컨텍스트 — 루트 레이아웃(서버)이 관리자 설정(orgName)을 읽어 주입한다. */
const OrgContext = createContext<string>("");

export function OrgProvider({ orgName, children }: { orgName: string; children: React.ReactNode }) {
  return <OrgContext.Provider value={orgName}>{children}</OrgContext.Provider>;
}

/** 관리자 설정의 기관명(미설정이면 빈 문자열). 문구 폴백은 src/lib/org.ts의 orgLabel()을 쓴다. */
export function useOrgName(): string {
  return useContext(OrgContext);
}
