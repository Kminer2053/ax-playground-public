/** 자료실 첨부 허용 확장자 — 클라이언트·서버 공용(서버 전용 모듈 import 금지). */
export const LIBRARY_FILE_EXTENSIONS = [
  "zip", "pdf", "hwpx", "hwp", "docx", "xlsx", "pptx", "txt", "md", "csv",
  "png", "jpg", "jpeg", "webp", "gif",
] as const;

export const LIBRARY_FILE_ACCEPT =
  ".zip,.pdf,.hwpx,.hwp,.docx,.xlsx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif";
