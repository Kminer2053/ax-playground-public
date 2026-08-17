/**
 * 온톨로지 수락 게이트 — 업무 관점 3형 질의 골드셋 실행(ONTOLOGY.md §7-2).
 * promoted && !stale 엣지만으로 소관/전결(한도)/업무근거를 답할 수 있는지 검증.
 * gold: data/work100/gold/queries.json. 각 문항 expect를 조회 결과와 대조(정확 부분집합).
 *
 * 실행: MONGODB_URI=... npx tsx src/scripts/eval-ontology-3type.ts
 */
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { resolveTask, taskOwnership, taskApproval, taskBasis } from "@/lib/ontology-query";

type Gold = {
  id: string;
  type: "소관" | "전결" | "업무근거";
  task: string; // 업무명(resolveTask로 해소)
  q: string; // 자연어 질의(문서화용)
  expect: {
    dept?: string; // 소관: 부서 라벨
    positions?: string[]; // 전결: 직위(부분집합 허용 — 최소 이만큼은 나와야)
    limit?: { min?: number | null; max?: number | null }; // 전결 한도(있으면)
    docs?: string[]; // 업무근거: 문서명(부분집합)
    minBasis?: number; // 업무근거: 최소 근거 수
  };
};

const norm = (s: string) => s.replace(/\s+/g, "").replace(/[·ㆍ‧․/]/g, "");
const includesNorm = (hay: string[], needle: string) => hay.some((h) => norm(h).includes(norm(needle)) || norm(needle).includes(norm(h)));

async function main() {
  await connectDb();
  const gold: Gold[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/work100/gold/queries.json"), "utf8"));
  let pass = 0;
  const fails: string[] = [];
  for (const g of gold) {
    const cands = await resolveTask(g.task);
    if (!cands.length) {
      fails.push(`${g.id} [${g.type}] "${g.task}" — Task 미해소(promoted 아님?)`);
      continue;
    }
    const taskId = cands[0].id;
    let ok = false;
    let got = "";
    if (g.type === "소관") {
      const own = await taskOwnership(taskId);
      got = own.map((o) => o.deptLabel ?? o.dept).join(", ");
      ok = g.expect.dept ? includesNorm(own.map((o) => o.deptLabel ?? o.dept), g.expect.dept) : own.length > 0;
    } else if (g.type === "전결") {
      const appr = await taskApproval(taskId);
      const positions = appr.map((a) => a.position);
      got = appr.map((a) => `${a.position}${a.limit ? `(${a.limit.text})` : ""}`).join(", ");
      ok = (g.expect.positions ?? []).every((p) => includesNorm(positions, p));
      if (ok && g.expect.limit) {
        const lim = appr.map((a) => a.limit).find(Boolean);
        if (g.expect.limit.max != null) ok = lim?.max === g.expect.limit.max;
        if (ok && g.expect.limit.min != null) ok = lim?.min === g.expect.limit.min;
      }
    } else {
      const basis = await taskBasis(taskId);
      got = basis.map((b) => `${b.doc} ${b.name}(${b.basis})`).join(" · ");
      const docs = basis.map((b) => b.doc);
      ok = (g.expect.docs ?? []).every((d) => includesNorm(docs, d));
      if (ok && g.expect.minBasis) ok = basis.length >= g.expect.minBasis;
    }
    if (ok) pass++;
    else fails.push(`${g.id} [${g.type}] "${g.task}" — 기대 ${JSON.stringify(g.expect)} / 실제: ${got || "(없음)"}`);
  }
  console.log(`\n[수락 게이트] ${pass}/${gold.length} 통과`);
  if (fails.length) {
    console.log("실패:");
    for (const f of fails) console.log("  ✗ " + f);
  }
  await mongoose.disconnect();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
