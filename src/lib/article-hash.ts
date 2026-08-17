/**
 * 조문 본문 해시 — 규정 개정 감지의 단일 기준.
 *
 * 온톨로지 엣지(evidence.srcHash)·보드 앵커·그래프 빌드가 모두 이 함수를 쓴다.
 * 규약이 갈라지면 개정 감지가 통째로 오탐/미탐이 되므로 **여기 외에 해시 계산을 두지 않는다.**
 *
 * 이력: 초기 생성기(gen-work100-grounds)는 조문 **앞 200자**만 해시했다.
 * 그 결과 201자 이후 개정이 감지되지 않는 사각지대가 있었다(위임전결 별표1은 12,361자 중 200자만 반영).
 * v2부터 **전체 본문**을 해시하며, 레거시 해시는 `matchesLegacy`로 식별해 마이그레이션한다.
 */
import { createHash } from "node:crypto";

/** 레거시 생성기가 해시에 쓴 본문 길이(앞 200자) */
export const LEGACY_BODY_LIMIT = 200;

const digest = (name: string, body: string) =>
  createHash("sha1").update(`${name}\n${String(body).replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);

/** 현행 규약 — 조문 전체 본문 기준 */
export function articleHash(name: string, fullText: string): string {
  return digest(name, fullText);
}

/** 레거시 규약 — 앞 200자 기준(구 엣지 식별용) */
export function legacyArticleHash(name: string, fullText: string): string {
  return digest(name, String(fullText).slice(0, LEGACY_BODY_LIMIT));
}

export type HashVerdict = "current" | "legacy" | "changed";

/**
 * 저장된 해시가 지금 조문과 맞는지 판정.
 * - `current`: 현행 규약으로 일치 — 변경 없음
 * - `legacy` : 레거시(200자) 규약으로 일치 — 내용은 같고 해시만 구식(마이그레이션 대상, 개정 아님)
 * - `changed`: 어느 규약으로도 불일치 — 실제 본문 변경
 */
export function verifyArticleHash(name: string, fullText: string, storedHash: string): HashVerdict {
  if (!storedHash) return "changed";
  if (articleHash(name, fullText) === storedHash) return "current";
  if (legacyArticleHash(name, fullText) === storedHash) return "legacy";
  return "changed";
}
