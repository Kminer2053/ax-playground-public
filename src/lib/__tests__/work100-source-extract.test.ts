/**
 * M2 소스 추출기 단위 테스트 (tsx, DB 무관 — 인라인 샘플).
 * 실행: npm run test:work100
 */
import assert from "node:assert/strict";
import { parseKoAmount, extractLimit, parseBunjangEopmu, parseJeongyeol } from "../work100-source-extract";

let pass = 0;
const t = (name: string, fn: () => void) => {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
};

console.log("[M2 소스 추출기 테스트]");

t("parseKoAmount — 만·억 단위", () => {
  assert.equal(parseKoAmount("이천만원"), 20000000);
  assert.equal(parseKoAmount("삼백만원"), 3000000);
  assert.equal(parseKoAmount("일억원"), 100000000);
  assert.equal(parseKoAmount("오천만원"), 50000000);
  assert.equal(parseKoAmount("일백만원"), 1000000);
  assert.equal(parseKoAmount("없음"), null);
});

t("extractLimit — 초과/이하/이상/미만", () => {
  assert.deepEqual(extractLimit("이천만원 초과 오천만원 이하의 물품"), { min: 20000000, max: 50000000, text: "이천만원 초과 오천만원 이하" });
  assert.deepEqual(extractLimit("일천만원 이하"), { min: null, max: 10000000, text: "일천만원 이하" });
  assert.deepEqual(extractLimit("일백만원 이상 이천만원 이하"), { min: 1000000, max: 20000000, text: "일백만원 이상 이천만원 이하" });
  assert.equal(extractLimit("금액 조건 없음"), null);
});

t("parseBunjangEopmu — 부서 구획·항목 분리", () => {
  const sample = "총무처 1. 각종 행사 및 회의 주관2. 본사 예산 운영3. 전사 입찰 및 본사 계약 평가관리처 1. 성과평가 운영2. 경영평가 대응";
  const r = parseBunjangEopmu(sample, ["총무처", "평가관리처"]);
  const 총무 = r.find((d) => d.dept === "총무처")!;
  assert.equal(총무.items.length, 3);
  assert.equal(총무.items[2], "전사 입찰 및 본사 계약");
  assert.equal(r.find((d) => d.dept === "평가관리처")!.items.length, 2);
});

t("parseJeongyeol — 섹션·직위(●) 매핑·limit", () => {
  const sample = [
    "○ 경영본부",
    "| 업무내용 | 전결권자 |  |  |",
    "| --- | --- | --- | --- |",
    "| 본부장 | 처장 |  |  |",
    "| 총무지원 | 1. 정보공개 제반 | ● |  |",
    "| 5. 이천만원 초과 오천만원 이하의 물품 구입 | ● |  |  |",
    "| 11. 물품구매ㆍ공사ㆍ용역 계약 체결 |  | ● |  |",
  ].join("\n");
  const rows = parseJeongyeol(sample);
  const r1 = rows.find((r) => r.num === 1)!;
  const r5 = rows.find((r) => r.num === 5)!;
  const r11 = rows.find((r) => r.num === 11)!;
  assert.deepEqual(r1.positions, ["본부장"]); // rowspan 부서명 밀림 보정
  assert.deepEqual(r5.positions, ["본부장"]);
  assert.deepEqual(r11.positions, ["처장"]); // 빈 셀 위치 보존으로 처장 정확
  assert.deepEqual(r5.limit, { min: 20000000, max: 50000000, text: "이천만원 초과 오천만원 이하" });
  assert.equal(r11.section, "경영본부");
});

console.log(`\n[통과] ${pass}/4 그룹`);
