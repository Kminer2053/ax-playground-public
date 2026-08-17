import { detectPii, maskPiiMatches, type PiiMatch } from "../pii-patterns";

export type MaskResult = {
  text: string;
  masked: PiiMatch[];
};

/**
 * GR3-1 (M13): 출력 PII 마스킹 (presidio Anonymizer 동급).
 * LLM 응답에 포함된 모든 PII를 플레이스홀더([RRN]/[PHONE]/[EMAIL] 등)로 치환.
 * 차단이 아닌 치환이므로 응답 자체는 사용자에게 전달된다.
 */
export function maskOutputPii(output: string): MaskResult {
  const matches = detectPii(output);
  if (matches.length === 0) return { text: output, masked: [] };
  return { text: maskPiiMatches(output, matches), masked: matches };
}
