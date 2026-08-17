/**
 * 온톨로지 매니페스트 검증기 단위 테스트 (tsx 실행, DB·외부 의존성 없음).
 * 실행: npm run test:ontology
 *
 * M1 핵심 계약: 매니페스트 밖 조합은 반드시 거부되고, 슬러그·정규화·승격 게이트가 규칙대로 동작한다.
 */
import assert from "node:assert/strict";
import {
  makeSlug,
  assertNodeAllowed,
  assertPositionLabel,
  assertEdgeAllowed,
  isEvidenceRequired,
  normalizeUndirected,
  canPromoteEdge,
  computeEdgeKey,
  positionInstances,
  OntologyViolation,
} from "../ontology-manifest";

let pass = 0;
function t(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}
const throws = (fn: () => void) => assert.throws(fn, OntologyViolation);

console.log("[온톨로지 검증기 테스트]");

t("makeSlug — 괄호 제거·중점 하이픈화·접두", () => {
  assert.equal(makeSlug("dept", "재무처"), "dept:재무처");
  assert.equal(makeSlug("dept", "직판사업처(무인판매센터)"), "dept:직판사업처");
  assert.equal(makeSlug("task", "물품구매ㆍ공사ㆍ용역"), "task:물품구매-공사-용역");
  assert.equal(makeSlug("dept", "경영지원처"), "dept:경영지원처");
  throws(() => makeSlug("dept", "(전부괄호)")); // 빈 결과 거부
});

t("assertNodeAllowed — reference_only·미지 공간/타입 거부", () => {
  assertNodeAllowed("org", "Dept"); // OK
  assertNodeAllowed("work", "Task"); // OK
  throws(() => assertNodeAllowed("corpus", "RegDoc")); // reference_only
  throws(() => assertNodeAllowed("org", "Nope")); // 미지 타입
  throws(() => assertNodeAllowed("xxx", "Dept")); // 미지 공간
});

t("assertPositionLabel — 닫힌 직위 목록", () => {
  assertPositionLabel("처장");
  assertPositionLabel("대표이사");
  assertPositionLabel("단장");
  throws(() => assertPositionLabel("파트장")); // 재위임 직위 미수용
  assert.ok(positionInstances().length === 8);
});

t("assertEdgeAllowed — 화이트리스트 조합만", () => {
  assertEdgeAllowed("work", "Task", "소관", "org", "Dept"); // OK
  assertEdgeAllowed("work", "Task", "전결", "org", "Position"); // OK
  assertEdgeAllowed("work", "Task", "업무근거", "corpus", "Article"); // OK
  assertEdgeAllowed("work", "Task", "업무근거", "corpus", "ExtLaw"); // OK
  assertEdgeAllowed("org", "Dept", "부서상하", "org", "Dept"); // OK
  throws(() => assertEdgeAllowed("org", "Dept", "소관", "org", "Dept")); // 소관 from은 Task
  throws(() => assertEdgeAllowed("work", "Task", "전결", "org", "Dept")); // 전결 to는 Position
  throws(() => assertEdgeAllowed("work", "Task", "없는관계", "org", "Dept"));
});

t("isEvidenceRequired — 소관·전결·업무근거만 필수", () => {
  assert.equal(isEvidenceRequired("소관"), true);
  assert.equal(isEvidenceRequired("전결"), true);
  assert.equal(isEvidenceRequired("업무근거"), true);
  assert.equal(isEvidenceRequired("부서상하"), false);
  assert.equal(isEvidenceRequired("협업"), false);
});

t("normalizeUndirected — 협업만 사전순 정렬", () => {
  assert.deepEqual(normalizeUndirected("협업", "task:나", "task:가"), { from: "task:가", to: "task:나" });
  assert.deepEqual(normalizeUndirected("협업", "task:가", "task:나"), { from: "task:가", to: "task:나" });
  assert.deepEqual(normalizeUndirected("선행", "task:나", "task:가"), { from: "task:나", to: "task:가" }); // 방향 유지
});

t("canPromoteEdge — external·evidence·stale 게이트", () => {
  assert.equal(canPromoteEdge({ rel: "소관", evidence: { doc: "직제규정 시행세칙" } }).ok, true);
  assert.equal(canPromoteEdge({ rel: "소관", evidence: null }).ok, false); // evidence 없음
  assert.equal(canPromoteEdge({ rel: "업무근거", evidence: { doc: "x", external: true } }).ok, false); // external
  assert.equal(canPromoteEdge({ rel: "소관", evidence: { doc: "x" }, stale: { reason: "doc_removed" } }).ok, false);
  assert.equal(canPromoteEdge({ rel: "부서상하" }).ok, true); // evidence optional
});

t("computeEdgeKey — 결정적·앵커/노드 구분", () => {
  const k1 = computeEdgeKey("task:a", "소관", "dept:b", { doc: "세칙", name: "별표6" });
  assert.equal(k1, "task:a|소관|dept:b|세칙|별표6|");
  const k2 = computeEdgeKey("task:a", "업무근거", { doc: "지침", name: "제42조", srcHash: "abc" }, { doc: "지침", name: "제42조" });
  assert.equal(k2, "task:a|업무근거|지침#제42조|지침|제42조|");
  assert.equal(computeEdgeKey("task:a", "소관", "dept:b"), computeEdgeKey("task:a", "소관", "dept:b")); // 동일 입력 동일 키
});

console.log(`\n[통과] ${pass}/8 그룹 · 위반 조합 전부 거부 확인`);
