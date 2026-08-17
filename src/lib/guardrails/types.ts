/**
 * AX Playground 가드레일 공통 타입.
 * 다이어그램 GR-1 / GR-2 / GR-3 단계에 대응.
 * 근거: 국가·공공기관 AI보안 가이드북 v2.0 (M09·M13·M14·M15·M16·M27)
 */

export type GuardPanel = "knowledge" | "pr" | "sales" | "safety" | "cs" | "ad" | "docs" | "ai" | "other";

/** 한 번의 LLM 요청에 따라붙는 호출자 컨텍스트. 라우트에서 채워 넘김. */
export type GuardContext = {
  /** iron-session 사용자 식별자. 비로그인 호출이면 null. */
  userId: string | null;
  /** 익명 클라이언트 식별자(ax_anon 쿠키) — 무로그인 환경의 rate-limit 버킷용. 없으면 null. */
  clientId: string | null;
  /** 사용자 권한(role). 차등 쿼터 등에 사용 — 현재는 로깅용. */
  role: string | null;
  /** 클라이언트 IP. Nginx의 X-Forwarded-For/X-Real-IP에서 추출. */
  ip: string;
  /** 호출 출처 패널 (감사 로그/쿼터 분리 키). */
  panel: GuardPanel;
  /** 요청 식별자 — 입·출력·차단 로그 상관관계용. */
  requestId: string;
  /** 클라이언트 연결 끊김 등 요청 취소 신호 — LLM 호출에 전달해 즉시 중단·슬롯 반납(H3). */
  signal?: AbortSignal;
};

/** 차단 사유. ruleId는 다이어그램 M-코드와 매핑된다 (docs/guardrail-mapping.md). */
export type GuardBlock = {
  stage: "input" | "model" | "output";
  reason: string;
  ruleId: string;
  /** 라우트에서 그대로 반환할 HTTP 상태 코드. */
  status: number;
};

export type GuardCheckResult = { ok: true } | { ok: false; block: GuardBlock };

/** 가드 차단 시 throw — 라우트에서 catch 하여 block.status로 응답. */
export class GuardBlockedError extends Error {
  readonly block: GuardBlock;
  constructor(block: GuardBlock) {
    super(`[guardrail blocked] ${block.stage}/${block.ruleId}: ${block.reason}`);
    this.name = "GuardBlockedError";
    this.block = block;
  }
}

export function isGuardBlockedError(e: unknown): e is GuardBlockedError {
  return e instanceof GuardBlockedError;
}
