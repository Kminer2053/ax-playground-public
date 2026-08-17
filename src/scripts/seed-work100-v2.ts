/**
 * 업무100 v2 적재 — 재커레이션 확정본(tasks-full.json 271: 본사 183+현업 88)을 온톨로지로.
 *
 * 매니페스트 0.4.0 기준:
 * · 개념축: Function 27(도메인 6 + 세부 21) + 상위분류(sub→domain) + 기능분류(Task→sub)
 * · 조직축 보강: 지역본부·동부본부 + 현업 단위 4(kind:현업) + 부서상하 (기존 본사 21은 유지)
 * · Task 271(props: desc·dept·org·fn·steps·alsoDepts)
 * · 소관: dutyRef 행마다 1엣지(evidence=별표6/7 행, 원문 대조 → validated/candidate)
 * · 전결: approvalRef 행 × 직위(복합 분할). JH(지역본부)는 extractLimit로 한도 구조화. candidate
 * · 업무근거(전결 결정적): 전결행 rowHash 중복 제거 → 위임전결 별표1 앵커, validated/RULE
 * · 선행(본사→현업): linkedToHQ의 D참조 → 해당 D를 근거로 가진 본사 Task로 결정적 연결. candidate
 *
 * 실행: MONGODB_URI=... npx tsx src/scripts/seed-work100-v2.ts [--dry]
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
import { extractLimit } from "@/lib/work100-source-extract";

const DRY = process.argv.includes("--dry");
const AT = new Date().toISOString();
const RULE: Provenance = { method: "rule", at: AT };
const LLM: Provenance = { method: "llm", model: "claude+fable-recurate", at: AT };

const B6_DOC = "직제규정 시행세칙";
const B6_NAME = "별표 제6호 (본사 부서별 분장업무)";
const B7_NAME = "별표 제7호 (지역본부 부서별 분장업무)";
const B1_DOC = "위임전결규정";
const B1_NAME = "별표 제1호 (전결사항)";

const rowHash = (s: string) => crypto.createHash("sha1").update(s.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
const srcHash = (name: string, body: string) =>
  crypto.createHash("sha1").update(`${name}\n${String(body).replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);
const norm = (s: string) => s.replace(/\s+/g, "").replace(/[·ㆍ‧․]/g, "");

type Duty = { id: string; dept: string; text: string; org: string };
type Jy = { id: string; dept: string; num: number; text: string; positions: string[]; limit: { min: number | null; max: number | null; text: string } | null; org: string };
type Task = {
  label: string; desc: string; steps: string[]; dutyRefs: string[]; approvalRefs?: string[];
  primaryDept: string; alsoDepts?: string[]; linkedToHQ?: string; fn: string; org?: string;
};

// 기능 체계(도메인 6 × 세부 21) — tasks-full.json fn 값과 정확 일치
const TAX: [string, string[]][] = [
  ["경영지원", ["경영기획·전략", "성과·혁신", "인사·급여", "인재개발·교육", "조직·행정지원"]],
  ["재무·계약", ["예산", "자금·금융", "회계·결산·세무", "계약·구매·조달"]],
  ["영업·상품", ["매장·영업운영", "상품·MD·물류", "고객·CS", "신성장·제휴사업"]],
  ["광고·홍보", ["광고사업", "홍보·브랜드"]],
  ["안전·시설", ["안전·재해·보건", "위생·품질", "자산·시설·장비"]],
  ["감사·정보", ["감사·윤리·법무", "정보시스템·보안", "문서·기록·사규"]],
];

// 현업 조직 단위(별표7) — Dept(kind:현업) + 상위
const FIELD_ORG: { label: string; parent: string; path: string }[] = [
  { label: "지역본부 지원팀", parent: "지역본부", path: "지역본부/지원팀" },
  { label: "지역본부 사업팀", parent: "지역본부", path: "지역본부/사업팀" },
  { label: "지역본부 지점", parent: "지역본부", path: "지역본부/지점" },
  { label: "동부본부(자원유통) 사업팀", parent: "동부본부", path: "동부본부/사업팀" },
];

async function main() {
  await connectDb();
  const pool = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/work100/recurate/duty-pool-full.json"), "utf8")) as { duties: Duty[]; jy: Jy[] };
  const tasks = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/work100/recurate/tasks-full.json"), "utf8")) as Task[];
  const dutyById = new Map(pool.duties.map((d) => [d.id, d]));
  const jyById = new Map(pool.jy.map((j) => [j.id, j]));

  // 원문(별표6·7·1) — 소관 원문 대조·별표1 srcHash 앵커
  const sch = (await RagRegulationModel.findOne({ title: B6_DOC }, { articles: 1 }).lean<{ articles: { name: string; fullText?: string }[] }>())!;
  const b6norm = norm(sch.articles.find((a) => /별표 제6호/.test(a.name))!.fullText!);
  const b7norm = norm(sch.articles.find((a) => /별표 제7호/.test(a.name))!.fullText!);
  const b1ft = (await RagRegulationModel.findOne({ title: B1_DOC }, { articles: 1 }).lean<{ articles: { name: string; fullText?: string }[] }>())!
    .articles.find((a) => /별표 제1호/.test(a.name))!.fullText!;
  const B1_HASH = srcHash(B1_NAME, b1ft);

  // ── 멱등 초기화: work·concept 전체 삭제(조직축 유지) ──
  if (!DRY) {
    const dn = await OntologyNodeModel.deleteMany({ type: { $in: ["Task", "Function"] } });
    const de = await OntologyEdgeModel.deleteMany({ rel: { $in: ["소관", "전결", "선행", "협업", "업무근거", "기능분류", "상위분류"] } });
    console.log(`[초기화] Task·Function ${dn.deletedCount} · work/concept 엣지 ${de.deletedCount} 삭제`);
  }

  // ── 조직축 보강: 현업 단위 ──
  const deptIds = new Map<string, string>();
  for (const d of await OntologyNodeModel.find({ type: "Dept" }).select("id label").lean<{ id: string; label: string }[]>()) deptIds.set(d.label, d.id);
  const parents = [...new Set(FIELD_ORG.map((f) => f.parent))];
  for (const p of parents) {
    if (!deptIds.has(p)) {
      const id = DRY ? makeSlug("dept", p) : await putNode({ space: "org", type: "Dept", label: p, props: { deptPath: p, kind: "지역본부", order: 90 }, status: "validated", provenance: { ...RULE } });
      deptIds.set(p, id);
    }
  }
  for (const f of FIELD_ORG) {
    if (!deptIds.has(f.label)) {
      const id = DRY ? makeSlug("dept", f.label) : await putNode({ space: "org", type: "Dept", label: f.label, props: { deptPath: f.path, kind: "현업", order: 91 }, status: "validated", provenance: { ...RULE } });
      deptIds.set(f.label, id);
      if (!DRY) await putEdge({ rel: "부서상하", from: deptIds.get(f.parent)!, to: id, fromSpace: "org", fromType: "Dept", toSpace: "org", toType: "Dept", status: "validated", provenance: { ...RULE } });
    }
  }
  console.log(`[조직축] 현업 단위 ${FIELD_ORG.length} + 상위 ${parents.length} 보강`);

  // Position 확보(기존 유지 — 없으면 시드)
  const posId = new Map<string, string>();
  for (const label of positionInstances()) {
    const id = DRY ? makeSlug("position", label) : await putNode({ space: "org", type: "Position", label, props: {}, status: "validated", provenance: { ...RULE } });
    posId.set(label, id);
  }

  // ── 개념축: Function 27 + 상위분류 ──
  const fnId = new Map<string, string>();
  for (const [domain, subs] of TAX) {
    const dId = DRY ? makeSlug("fn", domain) : await putNode({ space: "concept", type: "Function", label: domain, props: { level: "domain" }, status: "validated", provenance: { ...LLM } });
    fnId.set(domain, dId);
    for (const sub of subs) {
      const sId = DRY ? makeSlug("fn", sub) : await putNode({ space: "concept", type: "Function", label: sub, props: { level: "sub", domain }, status: "validated", provenance: { ...LLM } });
      fnId.set(sub, sId);
      if (!DRY) await putEdge({ rel: "상위분류", from: sId, to: dId, fromSpace: "concept", fromType: "Function", toSpace: "concept", toType: "Function", status: "validated", provenance: { ...RULE } });
    }
  }
  console.log(`[개념축] Function ${fnId.size} (도메인 6 + 세부 21) + 상위분류 21`);

  // ── Task + 엣지 ──
  const taskIdByLabel = new Map<string, string>();
  const dutyToTasks = new Map<string, string[]>(); // 선행 배선용(D→본사 Task)
  let nOwn = 0, nOwnVal = 0, nAppr = 0, nBasis = 0, nFn = 0;
  const missDept = new Set<string>();

  for (const t of tasks) {
    const org = t.org === "현업" ? "현업" : "본사";
    const taskId = makeSlug("task", t.label);
    taskIdByLabel.set(t.label, taskId);
    if (!DRY) await putNode({
      space: "work", type: "Task", id: taskId, label: t.label,
      props: { desc: t.desc, dept: t.primaryDept, org, fn: t.fn, steps: t.steps, alsoDepts: t.alsoDepts ?? [], linkedToHQ: t.linkedToHQ ?? null },
      status: "candidate", provenance: { ...LLM },
    });
    if (org === "본사") for (const r of t.dutyRefs) {
      if (!dutyToTasks.has(r)) dutyToTasks.set(r, []);
      dutyToTasks.get(r)!.push(taskId);
    }

    // 기능분류(세부기능으로)
    const sub = t.fn.split(">")[1]?.trim();
    const fid = fnId.get(sub);
    if (fid && !DRY) {
      await putEdge({ rel: "기능분류", from: taskId, to: fid, fromSpace: "work", fromType: "Task", toSpace: "concept", toType: "Function", status: "validated", provenance: { ...LLM } });
      nFn++;
    }

    // 소관 — dutyRef 행마다(부서는 행의 소속). 원문 대조 통과 시 validated
    for (const r of t.dutyRefs) {
      const d = dutyById.get(r);
      if (!d) continue;
      const dId = deptIds.get(d.dept);
      if (!dId) { missDept.add(d.dept); continue; }
      const isField = d.org === "현업";
      const quote = d.text.slice(0, 160);
      const ok = (isField ? b7norm : b6norm).includes(norm(quote).slice(0, 40));
      if (!DRY) await putEdge({
        rel: "소관", from: taskId, to: dId, fromSpace: "work", fromType: "Task", toSpace: "org", toType: "Dept",
        props: { primary: d.dept === t.primaryDept },
        evidence: { doc: B6_DOC, name: isField ? B7_NAME : B6_NAME, rowHash: rowHash(d.text), quote },
        status: ok ? "validated" : "candidate", rtConf: "상", provenance: { ...LLM },
      });
      nOwn++; if (ok) nOwnVal++;
    }

    // 전결 — approvalRef 행 × 직위. JH는 extractLimit로 한도 구조화
    const seenRow = new Set<string>();
    for (const r of t.approvalRefs ?? []) {
      const j = jyById.get(r);
      if (!j) continue;
      const positions = (j.positions ?? []).flatMap((p) => p.split("/")).map((p) => p.trim()).filter((p) => posId.has(p));
      const limit = j.limit ?? extractLimit(j.text);
      const rh = rowHash(j.text);
      for (const p of positions) {
        if (!DRY) await putEdge({
          rel: "전결", from: taskId, to: posId.get(p)!, fromSpace: "work", fromType: "Task", toSpace: "org", toType: "Position",
          props: { limit: limit ?? null, positionRule: positions.length > 1 ? `복합 전결열(${positions.join("/")})` : null, scope: j.org === "현업" ? "지역본부" : "본사" },
          evidence: { doc: B1_DOC, name: B1_NAME, rowHash: rh, quote: j.text.slice(0, 160) },
          status: "candidate", rtConf: "상", provenance: { ...LLM },
        });
        nAppr++;
      }
      // 업무근거(전결 결정적) — 행당 1건
      if (!seenRow.has(rh)) {
        seenRow.add(rh);
        if (!DRY) await putEdge({
          rel: "업무근거", from: taskId, to: { doc: B1_DOC, name: B1_NAME, srcHash: B1_HASH },
          fromSpace: "work", fromType: "Task", toSpace: "corpus", toType: "Article",
          props: { basis: "전결", note: limit?.text ? `전결 한도 ${limit.text}` : "전결권자 규율" },
          evidence: { doc: B1_DOC, name: B1_NAME, srcHash: B1_HASH, rowHash: rh, quote: j.text.slice(0, 120) },
          status: "validated", rtConf: "상", provenance: { ...RULE },
        });
        nBasis++;
      }
    }
  }
  console.log(`[적재] Task ${tasks.length} · 기능분류 ${nFn} · 소관 ${nOwn}(원문확인 ${nOwnVal}) · 전결 ${nAppr} · 업무근거(전결) ${nBasis}`);
  if (missDept.size) console.log(`  ⚠ Dept 미존재 소속: ${[...missDept].join(", ")}`);

  // ── 선행(본사→현업): linkedToHQ의 D참조 → 본사 Task 결정적 매칭 ──
  let nPrec = 0, nOrphan = 0;
  for (const t of tasks) {
    if (t.org !== "현업" || !t.linkedToHQ) continue;
    const fieldId = taskIdByLabel.get(t.label)!;
    const dRefs = [...new Set([...t.linkedToHQ.matchAll(/D\d+/g)].map((m) => m[0]))];
    const hqIds = [...new Set(dRefs.flatMap((d) => dutyToTasks.get(d) ?? []))];
    if (!hqIds.length) { nOrphan++; continue; }
    for (const hqId of hqIds) {
      if (!DRY) await putEdge({
        rel: "선행", from: hqId, to: fieldId, fromSpace: "work", fromType: "Task", toSpace: "work", toType: "Task",
        props: { note: `정책→집행: ${t.linkedToHQ.slice(0, 110)}` },
        status: "candidate", rtConf: "상", provenance: { ...LLM },
      });
      nPrec++;
    }
  }
  console.log(`[선행] 본사→현업 ${nPrec} · 앵커 미해소(참조 D 없음/일반문구) ${nOrphan}`);

  if (!DRY) {
    const cnt = async (q: object) => OntologyEdgeModel.countDocuments(q);
    console.log(`\n[대사] 노드 Task ${await OntologyNodeModel.countDocuments({ type: "Task" })} · Function ${await OntologyNodeModel.countDocuments({ type: "Function" })} · Dept ${await OntologyNodeModel.countDocuments({ type: "Dept" })}`);
    console.log(`  엣지 기능분류 ${await cnt({ rel: "기능분류" })} · 소관 ${await cnt({ rel: "소관" })} · 전결 ${await cnt({ rel: "전결" })} · 업무근거 ${await cnt({ rel: "업무근거" })} · 선행 ${await cnt({ rel: "선행" })} · 상위분류 ${await cnt({ rel: "상위분류" })}`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
