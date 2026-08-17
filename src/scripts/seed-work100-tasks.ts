/**
 * M2c-1 온톨로지 적재 — Task 노드 + 소관·전결 엣지 + 커버리지 대사.
 *
 * data/work100/tasks/<부서>.json(M2b candidate)을 읽어 온톨로지에 적재한다.
 * · Position 8종 시드(위임전결규정 제3조 근거)
 * · Task 노드(work:Task, id=부서+label 슬러그, candidate)
 * · 소관 엣지(Task→Dept): 분장업무를 evidence로. 커버리지 파티션(B) — 분장 1건은 1 Task에만,
 *   중복이면 첫 참조 Task에 주 배정하고 나머지는 스킵+플래그, 누락은 대사 리포트.
 * · 전결 엣지(Task→Position): 전결 행을 evidence로(직위별 분할, limit·positionRule).
 * 게이트: 앵커 실존(Dept/Position) + evidence 원문 대조(quote가 별표 fullText에 존재) 통과 → validated.
 *
 * 실행: MONGODB_URI=... npx tsx src/scripts/seed-work100-tasks.ts [--dry]
 */
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { OntologyEdgeModel } from "@/models/OntologyEdge";
import { putNode, putEdge, type Provenance } from "@/lib/ontology-store";
import { makeSlug, positionInstances } from "@/lib/ontology-manifest";
import { cleanDutyText } from "@/lib/work100-source-extract";

const DRY = process.argv.includes("--dry");
const AT = new Date().toISOString();
const RULE: Provenance = { method: "rule", at: AT };
const LLM: Provenance = { method: "llm", model: "google/gemma-4-E4B-it", at: AT };
const TASK_DIR = path.join(process.cwd(), "data/work100/tasks");
const B6_DOC = "직제규정 시행세칙";
const B6_NAME = "별표 제6호 (본사 부서별 분장업무)";
const B1_DOC = "위임전결규정";
const B1_NAME = "별표 제1호 (전결사항)";

const rowHash = (s: string) => crypto.createHash("sha1").update(s.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
const norm = (s: string) => s.replace(/\s+/g, "").replace(/[·ㆍ‧․]/g, "");

type TaskFile = {
  dept: string;
  deptPath: string;
  duties: string[];
  jy: { num: number; text: string; positions: string[]; limit: { min: number | null; max: number | null; text: string } | null }[];
  tasks: { label: string; desc: string; dutyRefs: number[]; approvalRefs: number[] }[];
};

async function main() {
  await connectDb();
  const b6ft = (await RagRegulationModel.findOne({ title: B6_DOC }, { articles: 1 }).lean<{
    articles: { name: string; fullText?: string }[];
  }>())!.articles.find((a) => /별표 제6호/.test(a.name))!.fullText!;
  const b6norm = norm(b6ft);
  const deptIds = new Set((await OntologyNodeModel.find({ type: "Dept" }).select("id").lean<{ id: string }[]>()).map((d) => d.id));

  // 멱등 재적재 — 기존 Task 노드·work100 엣지 삭제(조직축 Dept·부서상하·Position은 유지)
  if (!DRY) {
    const dn = await OntologyNodeModel.deleteMany({ type: "Task" });
    const de = await OntologyEdgeModel.deleteMany({ rel: { $in: ["소관", "전결", "선행", "협업", "업무근거"] } });
    console.log(`[초기화] 기존 Task ${dn.deletedCount} · work100 엣지 ${de.deletedCount} 삭제`);
  }

  // ── Position 8종 시드 ──
  console.log(`[Position] ${positionInstances().length}종 시드`);
  const posId = new Map<string, string>();
  for (const label of positionInstances()) {
    const id = DRY ? makeSlug("position", label) : await putNode({
      space: "org",
      type: "Position",
      label,
      props: {},
      status: "validated",
      provenance: { ...RULE },
    });
    posId.set(label, id);
  }

  const report: Record<string, { tasks: number; own: number; ownDup: number; appr: number; missing: number[]; dup: number[] }> = {};
  const files = fs.readdirSync(TASK_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const tf: TaskFile = JSON.parse(fs.readFileSync(path.join(TASK_DIR, f), "utf8"));
    const deptId = makeSlug("dept", tf.dept);
    if (!deptIds.has(deptId)) {
      console.log(`  ⚠ ${tf.dept}: Dept 노드(${deptId}) 미존재 → skip`);
      continue;
    }
    // 커버리지 파티션(B): dutyNum → 참조 Task 인덱스들
    const dutyUsed = new Map<number, number[]>();
    tf.tasks.forEach((t, ti) => (t.dutyRefs || []).forEach((n) => {
      if (!dutyUsed.has(n)) dutyUsed.set(n, []);
      dutyUsed.get(n)!.push(ti);
    }));
    const missing = Array.from({ length: tf.duties.length }, (_, i) => i + 1).filter((n) => !dutyUsed.has(n));
    const dup = [...dutyUsed.entries()].filter(([, v]) => v.length >= 2).map(([n]) => n);

    const stat = { tasks: 0, own: 0, ownDup: 0, appr: 0, missing, dup };
    for (let ti = 0; ti < tf.tasks.length; ti++) {
      const t = tf.tasks[ti];
      const taskId = makeSlug("task", `${tf.dept} ${t.label}`);
      if (!DRY) await putNode({
        space: "work",
        type: "Task",
        id: taskId,
        label: t.label,
        props: { desc: t.desc, dept: tf.dept },
        status: "candidate",
        provenance: { ...LLM },
      });
      stat.tasks++;

      // 소관 엣지 — 이 Task가 '주 배정'인 분장만(중복은 첫 Task가 주). evidence=분장업무 행
      for (const n of t.dutyRefs || []) {
        const owners = dutyUsed.get(n) || [];
        const isPrimary = owners[0] === ti;
        if (!isPrimary) { stat.ownDup++; continue; } // 중복 — 주 아닌 참조는 소관 엣지 미생성(플래그는 리포트)
        const quote = cleanDutyText(tf.duties[n - 1] ?? "");
        if (!quote) continue;
        const quoteOk = b6norm.includes(norm(quote).slice(0, 40)); // evidence 원문 대조
        if (!DRY) await putEdge({
          rel: "소관",
          from: taskId,
          to: deptId,
          fromSpace: "work",
          fromType: "Task",
          toSpace: "org",
          toType: "Dept",
          evidence: { doc: B6_DOC, name: B6_NAME, rowHash: rowHash(quote), quote },
          status: quoteOk ? "validated" : "candidate",
          rtConf: "상",
          provenance: { ...LLM },
        });
        stat.own++;
      }

      // 전결 엣지 — approvalRefs → 전결 행, 직위별 분할. evidence=전결 행
      for (const n of t.approvalRefs || []) {
        const row = tf.jy.find((r) => r.num === n);
        if (!row || !row.positions?.length) continue;
        for (const pos of row.positions) {
          const pid = posId.get(pos);
          if (!pid) continue;
          if (!DRY) await putEdge({
            rel: "전결",
            from: taskId,
            to: pid,
            fromSpace: "work",
            fromType: "Task",
            toSpace: "org",
            toType: "Position",
            props: {
              limit: row.limit ?? null,
              positionRule: row.positions.length > 1 ? `복합 전결열(${row.positions.join("/")})` : null,
            },
            evidence: { doc: B1_DOC, name: B1_NAME, rowHash: rowHash(row.text), quote: row.text },
            status: "candidate", // 전결은 별표1↔개별규정 상충 검토 필요(매니페스트) → 관리자 승인 전 candidate
            rtConf: "상",
            provenance: { ...LLM },
          });
          stat.appr++;
        }
      }
    }
    report[tf.dept] = stat;
    const flag = missing.length || dup.length ? " ⚠" : "";
    console.log(`  ${tf.dept}: Task ${stat.tasks} · 소관 ${stat.own}(중복스킵 ${stat.ownDup}) · 전결 ${stat.appr} · 누락 ${missing.length}${missing.length ? JSON.stringify(missing) : ""}${flag}`);
  }

  // 커버리지 대사 리포트 저장(검토 큐 입력)
  const totMiss = Object.values(report).reduce((a, r) => a + r.missing.length, 0);
  const totDup = Object.values(report).reduce((a, r) => a + r.dup.length, 0);
  fs.writeFileSync(path.join(process.cwd(), "data/work100/coverage-report.json"), JSON.stringify(report, null, 1));
  console.log(`\n[대사] 부서 ${Object.keys(report).length} · 누락 분장 ${totMiss} · 중복 분장 ${totDup}(주 Task 배정, 나머지 스킵)`);
  console.log(`  누락 분장은 검토 큐 대상 — data/work100/coverage-report.json`);
  if (!DRY) {
    const nN = await OntologyNodeModel.countDocuments({ type: "Task" });
    console.log(`  적재: Task 노드 ${nN} · (소관·전결 엣지는 ontology_edges)`);
  }
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
