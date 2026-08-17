import type { GuardCheckResult } from "../types";

/**
 * GR1-1 (M14): 입력 길이 제한.
 * - 8,000자 상한 (다이어그램 명시값).
 * - 토큰 추정 상한 (한국어+영어 혼합 대략 2.5 chars/token 가정).
 */
export const MAX_INPUT_CHARS = 8_000;
export const MAX_INPUT_TOKENS_ESTIMATE = 4_000;

/** chars→tokens 추정 (보수적). 정확도가 중요하면 tokenizer 도입 가능. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.5);
}

export function checkLength(input: string, opts?: { maxChars?: number }): GuardCheckResult {
  const maxChars = opts?.maxChars ?? MAX_INPUT_CHARS;
  const maxTokens = Math.ceil(maxChars / 2.5);
  if (input.length > maxChars) {
    return {
      ok: false,
      block: {
        stage: "input",
        reason: `입력이 ${maxChars.toLocaleString()}자를 초과했습니다 (${input.length.toLocaleString()}자).`,
        ruleId: "M14-input-length",
        status: 413,
      },
    };
  }
  const tokens = estimateTokens(input);
  if (tokens > maxTokens) {
    return {
      ok: false,
      block: {
        stage: "input",
        reason: `입력 토큰 추정치가 상한을 초과했습니다 (≈${tokens.toLocaleString()} > ${maxTokens.toLocaleString()}).`,
        ruleId: "M14-input-tokens",
        status: 413,
      },
    };
  }
  return { ok: true };
}
