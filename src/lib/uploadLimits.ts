/**
 * 업로드 한도 단일 출처 — 관리자 UI·playgroundConfig·next.config(proxy)가 동일 값을 참조한다.
 * 영상 등록은 multipart 1요청에 영상+썸네일이 함께 실리므로 proxy 상한 = 파일·이미지 관리자 상한 합 + 오버헤드.
 */

export const ADMIN_MAX_IMAGE_MB = 2048;
export const ADMIN_MAX_FILE_MB = 4096;

/** Next.js proxy(구 middleware) 요청 본문 버퍼 — 관리자에서 설정 가능한 최대 조합을 수용 */
export const PROXY_CLIENT_MAX_BODY_MB = ADMIN_MAX_FILE_MB + ADMIN_MAX_IMAGE_MB + 32;

export type UploadLimitsMeta = {
  maxImageMb: number;
  maxFileMb: number;
  proxyBodyMb: number;
};

export function getUploadLimitsMeta(): UploadLimitsMeta {
  return {
    maxImageMb: ADMIN_MAX_IMAGE_MB,
    maxFileMb: ADMIN_MAX_FILE_MB,
    proxyBodyMb: PROXY_CLIENT_MAX_BODY_MB,
  };
}
