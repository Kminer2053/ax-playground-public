/**
 * M2 소스 추출기 검증 — 한글 금액 유닛 + 실데이터(별표6·별표1) 파싱 결과 확인.
 * 실행: MONGODB_URI=... npx tsx src/scripts/diag-work100-source.ts
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { parseKoAmount, extractLimit, parseBunjangEopmu, parseJeongyeol } from "@/lib/work100-source-extract";

function unitAmount() {
  console.log("[한글 금액 유닛]");
  const cases: [string, number][] = [
    ["이천만원", 20000000],
    ["삼백만원", 3000000],
    ["오천만원", 50000000],
    ["일천만원", 10000000],
    ["팔천만원", 80000000],
    ["일백만원", 1000000],
    ["일억원", 100000000],
    ["삼천만원", 30000000],
  ];
  for (const [s, exp] of cases) assert.equal(parseKoAmount(s), exp, `${s} → ${exp}`);
  assert.deepEqual(extractLimit("이천만원 초과 오천만원 이하의 물품 구입 및 용역"), {
    min: 20000000,
    max: 50000000,
    text: "이천만원 초과 오천만원 이하",
  });
  assert.deepEqual(extractLimit("일천만원 이하의 유지보수"), { min: null, max: 10000000, text: "일천만원 이하" });
  assert.equal(extractLimit("판매촉진비 집행"), null);
  console.log("  ✓ 금액 8종·limit 3종 통과\n");
}

async function main() {
  unitAmount();
  await connectDb();
  // 최말단 부서만 앵커(본부는 분장업무 없는 그룹 — 세로쓰기 헤더가 처 블록을 자르므로 제외)
  const deptLabels = (await OntologyNodeModel.find({ type: "Dept" }).select("label").lean<{ label: string }[]>())
    .map((d) => d.label)
    .filter((l) => !/본부$/.test(l));
  const doc = await RagRegulationModel.findOne({ title: "직제규정 시행세칙" }, { articles: 1 }).lean<{
    articles: { name: string; fullText?: string }[];
  }>();
  const b6 = doc!.articles.find((a) => /별표 제6호/.test(a.name))!;
  const duties = parseBunjangEopmu(b6.fullText ?? "", deptLabels);
  console.log(`[별표6 구획] ${duties.length}부서 매칭 / Dept ${deptLabels.length}`);
  const SAMPLE_DEPT = process.argv.find((a) => a.startsWith("--dept="))?.slice(7) ?? "경영지원처";
  const sample = duties.find((d) => d.dept === SAMPLE_DEPT) ?? duties[0];
  if (sample) {
    console.log(`  ${sample.dept} 분장업무 ${sample.items.length}항목:`);
    sample.items.forEach((it, i) => console.log(`    ${i + 1}. ${it.slice(0, 50)}`));
  } else {
    console.log("  (분장업무 매칭 부서 없음)");
  }

  const w = await RagRegulationModel.findOne({ title: "위임전결규정" }, { articles: 1 }).lean<{
    articles: { name: string; fullText?: string }[];
  }>();
  const b1 = w!.articles.find((a) => a.name === "별표 제1호 (전결사항)")!;
  const jy = parseJeongyeol(b1.fullText ?? "");
  const bySec = new Map<string, number>();
  jy.forEach((r) => bySec.set(r.section, (bySec.get(r.section) ?? 0) + 1));
  console.log(`\n[별표1 전결] 총 ${jy.length}행 · 섹션별:`, [...bySec.entries()].map(([s, n]) => `${s}:${n}`).join(" "));
  const SAMPLE_HONBU = process.argv.find((a) => a.startsWith("--honbu="))?.slice(8) ?? "운영관리";
  console.log(`  ${SAMPLE_HONBU} 계약/물품 전결(직위·limit):`);
  jy.filter((r) => r.section.startsWith(SAMPLE_HONBU) && /계약|물품|용역/.test(r.text)).forEach((r) =>
    console.log(`    ${r.num}. [${r.positions.join(",") || "?"}] ${r.limit ? `{${r.limit.min}~${r.limit.max}}` : ""} ${r.text.slice(0, 45)}`),
  );
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
