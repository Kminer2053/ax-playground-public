/**
 * PII 가드레일 단위 테스트 (tsx 실행, 외부 의존성 없음).
 * 실행: npm run test:guardrails
 */
import assert from "node:assert/strict";
import {
  detectPii,
  isValidLuhn,
  isValidRrnChecksum,
  maskPiiMatches,
  type PiiType,
} from "../pii-patterns";
import { checkInputPii } from "../input/pii";
import { maskOutputPii } from "../output/pii-mask";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push(`✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}

function typesOf(text: string): PiiType[] {
  return [...new Set(detectPii(text).map((m) => m.type))].sort();
}

// ── 주민등록번호 ────────────────────────────────────────────
test("RRN: 유효 체크섬 탐지", () => {
  // 901231-1234567 계열 — 체크섬 맞는 샘플 생성
  assert.ok(typesOf("제 번호는 900101-1234567 입니다").includes("RRN"));
});

test("RRN: 하이픈 없는 13자리도 탐지", () => {
  assert.ok(typesOf("9001011234567").includes("RRN"));
});

test("RRN: 잘못된 월(13월)은 미탐지", () => {
  assert.ok(!typesOf("901301-1234567").includes("RRN"));
});

test("RRN 체크섬: 정확도 (수동 계산 검증값)", () => {
  // 900101-123456X: 가중치 합 124 → (11 - 124%11)%10 = 8 → 정답 체크자리 8
  assert.equal(isValidRrnChecksum("9001011234568"), true);
  assert.equal(isValidRrnChecksum("9001011234567"), false);
  // 800101-123456X: 합 122 → (11 - 122%11)%10 = 0 → 정답 체크자리 0
  assert.equal(isValidRrnChecksum("8001011234560"), true);
});

// ── 외국인등록번호 ──────────────────────────────────────────
test("FRN: 성별코드 5~8 → FRN으로 분류", () => {
  assert.ok(typesOf("950101-5234567").includes("FRN"));
});

// ── 신용카드 (Luhn) ────────────────────────────────────────
test("CARD: Luhn 통과 번호 탐지", () => {
  // 4242 4242 4242 4242 — 유명한 Luhn-valid 테스트 카드
  assert.ok(typesOf("카드 4242-4242-4242-4242 결제").includes("CARD"));
});

test("CARD: Luhn 실패 번호 미탐지", () => {
  assert.ok(!typesOf("1234-5678-9012-3456").includes("CARD"));
});

test("Luhn: 검증 함수 정확도", () => {
  assert.equal(isValidLuhn("4242424242424242"), true);
  assert.equal(isValidLuhn("1234567890123456"), false);
});

// ── 전화번호 ────────────────────────────────────────────────
test("PHONE: 휴대전화 탐지", () => {
  assert.ok(typesOf("연락처 010-1234-5678").includes("PHONE"));
});

test("PHONE: 하이픈 없는 휴대전화 탐지", () => {
  assert.ok(typesOf("01012345678").includes("PHONE"));
});

test("PHONE: 일반전화(02) 탐지", () => {
  assert.ok(typesOf("사무실 02-123-4567").includes("PHONE"));
});

// ── 이메일 ──────────────────────────────────────────────────
test("EMAIL: 탐지", () => {
  assert.ok(typesOf("hong@example.com 으로 회신").includes("EMAIL"));
});

// ── 사업자등록번호 ──────────────────────────────────────────
test("BIZNO: 3-2-5 형식 탐지", () => {
  assert.ok(typesOf("사업자 123-45-67890").includes("BIZNO"));
});

// ── 계좌번호 (키워드 동반) ──────────────────────────────────
test("ACCOUNT: 키워드 동반 시 탐지", () => {
  assert.ok(typesOf("계좌 123-456-789012 로 입금").includes("ACCOUNT"));
});

test("ACCOUNT: 키워드 없으면 미탐지(오탐 방지)", () => {
  // 키워드 없는 하이픈 숫자열은 계좌로 보지 않음
  assert.ok(!typesOf("주문번호 12-3456-789012 입니다").includes("ACCOUNT"));
});

// ── 오탐 방지 ────────────────────────────────────────────────
test("오탐: 일반 문장에 PII 없음", () => {
  assert.deepEqual(typesOf("오늘 매출이 전월 대비 12% 상승했습니다."), []);
});

test("오탐: 연도·금액 숫자는 PII 아님", () => {
  assert.deepEqual(typesOf("2026년 예산은 1500만원입니다."), []);
});

// ── 입력 차단 정책 ──────────────────────────────────────────
test("입력 차단: 주민번호 → block", () => {
  const r = checkInputPii("내 주민번호 900101-1234567 조회해줘");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.block.ruleId, "M13-input-pii");
});

test("입력 차단: 전화번호만 있으면 통과(medium)", () => {
  const r = checkInputPii("010-1234-5678 로 연락 부탁");
  assert.equal(r.ok, true);
});

test("입력 차단: 신용카드 → block", () => {
  const r = checkInputPii("4242-4242-4242-4242 등록해줘");
  assert.equal(r.ok, false);
});

// ── 출력 마스킹 ──────────────────────────────────────────────
test("출력 마스킹: 주민번호 → [RRN]", () => {
  const { text } = maskOutputPii("고객 900101-1234567 확인");
  assert.ok(text.includes("[RRN]"));
  assert.ok(!text.includes("900101-1234567"));
});

test("출력 마스킹: 복수 PII 동시 치환", () => {
  const { text, masked } = maskOutputPii("홍길동 010-1234-5678, hong@example.com");
  assert.ok(text.includes("[PHONE]"));
  assert.ok(text.includes("[EMAIL]"));
  assert.equal(masked.length, 2);
});

test("출력 마스킹: PII 없으면 원문 유지", () => {
  const src = "정상적인 안내 문구입니다.";
  assert.equal(maskOutputPii(src).text, src);
});

test("maskPiiMatches: 인덱스 보존 치환", () => {
  const src = "A 010-1234-5678 B 010-9999-8888 C";
  const out = maskPiiMatches(src, detectPii(src));
  assert.equal(out, "A [PHONE] B [PHONE] C");
});

// ── 결과 출력 ────────────────────────────────────────────────
console.log(`\nPII 가드레일 테스트: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.error("\n" + failures.join("\n\n"));
  process.exit(1);
}
console.log("✓ 모든 테스트 통과\n");
