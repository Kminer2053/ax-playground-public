/**
 * 기관명 표기 헬퍼 — 기관명은 코드가 아니라 관리자 설정(playground_config.orgName)에서 온다.
 * 서버는 getPlaygroundConfig().orgName, 클라이언트는 useOrgName()(OrgProvider)으로 값을 받아
 * 아래 헬퍼로 폴백을 통일한다.
 */

/** 화면·프롬프트 문구용 — 미설정이면 "우리 기관". */
export const orgLabel = (orgName?: string | null): string => (orgName ?? "").trim() || "우리 기관";

/** 생성 문서(HWPX 서명·발신 기관 등) 필드용 — 미설정이면 "○○기관"(ceoName의 "○○○" 관례와 동일). */
export const orgDocLabel = (orgName?: string | null): string => (orgName ?? "").trim() || "○○기관";
