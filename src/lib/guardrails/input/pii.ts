import { detectPii, type PiiType } from "../pii-patterns";
import type { GuardCheckResult } from "../types";

/**
 * GR1-3 (M13): PII 입력 차단.
 * 고위험(severity=high) PII가 입력에 포함되면 LLM 도달 전 차단.
 * 연락처(전화/이메일 등 medium)는 입력은 허용하고 출력 단계에서 마스킹한다.
 *
 * BLOCK_ON_INPUT은 운영 정책에 따라 조정 가능 — 차단 대상 타입 집합.
 * 다이어그램은 "주민번호·전화번호" 차단을 명시하나, 업무 방해를 줄이기 위해
 * 기본값은 고위험 식별번호만 차단하고 전화번호는 출력 마스킹으로 처리한다.
 * (감리 대응: docs/guardrail-mapping.md 에 정책 근거 기재)
 */
const BLOCK_ON_INPUT: ReadonlySet<PiiType> = new Set<PiiType>([
  "RRN",
  "FRN",
  "CARD",
  "ACCOUNT",
]);

const TYPE_LABEL: Record<PiiType, string> = {
  RRN: "주민등록번호",
  FRN: "외국인등록번호",
  CARD: "신용카드번호",
  ACCOUNT: "계좌번호",
  BIZNO: "사업자등록번호",
  PHONE: "전화번호",
  EMAIL: "이메일",
};

export function checkInputPii(
  input: string,
  opts?: { blockTypes?: ReadonlySet<PiiType> },
): GuardCheckResult {
  const blockSet = opts?.blockTypes ?? BLOCK_ON_INPUT;
  const matches = detectPii(input);
  const blocking = matches.filter((m) => blockSet.has(m.type));

  if (blocking.length > 0) {
    const types = [...new Set(blocking.map((m) => TYPE_LABEL[m.type]))].join(", ");
    return {
      ok: false,
      block: {
        stage: "input",
        reason: `입력에 개인정보(${types})가 포함되어 차단되었습니다. 개인정보를 제거한 뒤 다시 시도해 주세요.`,
        ruleId: "M13-input-pii",
        status: 422,
      },
    };
  }
  return { ok: true };
}
