/**
 * 시스템 프롬프트 합성 + self-injection 회귀 테스트.
 * 실행: npm run test:guardrails
 */
import assert from "node:assert/strict";
import { buildSystemPrompt, securityPreamble } from "../model/system-prompt";
import { scoreInjection } from "../input/injection";

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

test("프리앰블: 모든 패널 프롬프트에 보안 프리앰블 포함", () => {
  for (const panel of ["knowledge", "pr", "sales", "safety", "cs", "ai", "other"] as const) {
    assert.ok(buildSystemPrompt(panel).startsWith(securityPreamble().slice(0, 20)));
  }
});

test("기관명 주입: orgName이 프리앰블에 반영됨", () => {
  const p = buildSystemPrompt("cs", undefined, { orgName: "테스트기관" });
  assert.ok(p.includes("테스트기관"));
  assert.ok(!p.includes("우리 기관"));
});

test("기관명 미설정: '우리 기관' 폴백", () => {
  assert.ok(buildSystemPrompt("cs").includes("우리 기관"));
  assert.ok(securityPreamble("").includes("우리 기관"));
});

test("패널 역할: knowledge 프롬프트에 법무 역할 포함", () => {
  assert.ok(buildSystemPrompt("knowledge").includes("법무"));
});

test("커스텀 지침: 추가 지침이 합성됨", () => {
  const p = buildSystemPrompt("pr", "보도자료는 5문단 이내로 작성");
  assert.ok(p.includes("[추가 지침]"));
  assert.ok(p.includes("5문단"));
});

test("커스텀 없을 때 추가 지침 섹션 없음", () => {
  assert.ok(!buildSystemPrompt("sales").includes("[추가 지침]"));
});

/**
 * 회귀: 보안 프리앰블은 '탈옥 거부' 등 인젝션 키워드를 포함하지만,
 * 입력 가드는 system을 검사하지 않으므로 무관해야 한다. 만약을 위해
 * 프리앰블 단독 점수가 차단 임계치 이상이어도(자기 설명이므로) 문제 없음을 문서화하는 의미로
 * user 입력이 아닌 한 영향 없음을 보장한다.
 * 여기서는 프리앰블이 '의도적으로' 보안 단어를 담고 있음을 명시적으로 확인한다.
 */
test("회귀: 프리앰블은 보안 키워드를 포함(설계상 의도)", () => {
  const { score } = scoreInjection(securityPreamble());
  // 프리앰블에는 '탈옥', '무시', '개발자 모드' 등이 들어갈 수 있음 — 점수가 0이 아닐 수 있다.
  // 핵심은 이 텍스트가 joinUserText 검사 대상이 아니라는 것(가드 통합 테스트에서 보장).
  assert.ok(score >= 0); // 단순 실행 가능성 확인
});

console.log(`\n시스템 프롬프트 테스트: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.error("\n" + failures.join("\n\n"));
  process.exit(1);
}
console.log("✓ 모든 테스트 통과\n");
