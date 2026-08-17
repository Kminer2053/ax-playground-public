/**
 * 온톨로지 승격 CLI (시범 단계 공식 우회로 — ONTOLOGY.md §9).
 * candidate/validated 엣지를 매니페스트 승격 게이트(canPromoteEdge: evidence·external·stale) 통과 시
 * promoted로 올리고, 양단 노드도 함께 승격한다. provenance.method="human"(운영자 검토 기록).
 * 런타임은 promoted && !stale만 소비하므로, 승격은 "이 답변을 근거로 노출해도 좋다"는 인간 결재와 동치.
 *
 * 정책(기본): 소관·전결·업무근거(전결 basis, validated) 승격. LLM 회수 근거(candidate)는
 *   --with-llm-grounds 명시 시에만(운영자가 검토했다는 선언).
 *
 * 실행: MONGODB_URI=... npx tsx src/scripts/ontology-promote.ts \
 *   [--task task:...] [--dept 경영지원처] [--pilot] [--with-llm-grounds] [--dry] [--demote]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { OntologyEdgeModel } from "@/models/OntologyEdge";
import { canPromoteEdge } from "@/lib/ontology-manifest";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes("--dry");
const DEMOTE = process.argv.includes("--demote"); // 승격 취소(promoted→직전상태 복원은 불가하므로 candidate로)
const WITH_LLM = process.argv.includes("--with-llm-grounds");
const PILOT = process.argv.includes("--pilot");
const AT = new Date().toISOString();

// 시범 12업무(v2 기능축) — 한도 경계·본사/현업·선행(정책→집행) 체인·회수근거 다수 커버.
// label은 makeSlug("task", label) 대상 원문(v2는 dept 접두 없음).
const PILOT_TASKS = [
  "사회공헌활동 시행", // 본사 한도 경계: 처장 200만 이하 / 본부장 200만~1000만
  "영업장 전도자금 지급", // 본사 한도 상한: 처장 50만 이하
  "사원 채용·임용",
  "이사회·주총 소집", // 회수근거 다수(8)
  "결산·재무제표 확정",
  "유통 사업계획 수립", // 선행 소스(본사 정책 → 현업 3연결)
  "관할 매장 운영·점검", // 현업(사업팀+지점 소관 교차)
  "영업 시행계획 수립", // 현업 — 유통 사업계획의 집행
  "관할 매장 목표액 수립", // 현업
  "영업결산 마감", // 현업(본사 결산기준 집행)
  "사무용품 소액구매 집행", // 현업 한도: 지점장·팀장 100만 이하
  "물품·용역 조달계약 집행", // 현업 한도 경계: 본부장 100만~2000만
];

async function main() {
  await connectDb();
  // 대상 Task 수집
  const q: Record<string, unknown> = { type: "Task" };
  const byTask = arg("task");
  const byDept = arg("dept");
  if (byTask) q.id = byTask;
  else if (byDept) q["props.dept"] = byDept;
  else if (PILOT) {
    const { makeSlug } = await import("@/lib/ontology-manifest");
    q.id = { $in: PILOT_TASKS.map((t) => makeSlug("task", t)) };
  } else throw new Error("대상 미지정: --task / --dept / --pilot 중 하나");

  const tasks = await OntologyNodeModel.find(q).select("id label props status").lean<
    { id: string; label: string; props?: { dept?: string }; status: string }[]
  >();
  if (!tasks.length) throw new Error("대상 Task 없음");

  const target = DEMOTE ? "candidate" : "promoted";
  const nodeIds = new Set<string>();
  const pilotIds = new Set(tasks.map((t) => t.id)); // 선행(Task→Task)은 양단이 대상일 때만 승격
  let edgeN = 0;
  let heldN = 0;
  const held: string[] = [];

  for (const t of tasks) {
    nodeIds.add(t.id);
    const edges = await OntologyEdgeModel.find({ from: t.id, rel: { $in: ["소관", "전결", "업무근거", "기능분류", "선행"] } }).lean<
      {
        _id: mongoose.Types.ObjectId;
        rel: string;
        to: unknown;
        toSpace?: string;
        status: string;
        evidence?: { doc?: string; external?: boolean } | null;
        stale?: unknown;
        props?: { basis?: string };
        provenance?: { method?: string };
      }[]
    >();
    for (const e of edges) {
      if (DEMOTE) {
        if (!DRY) await OntologyEdgeModel.updateOne({ _id: e._id }, { $set: { status: "candidate" } });
        edgeN++;
        continue;
      }
      // 정책: LLM 회수 근거(candidate + provenance.llm)는 --with-llm-grounds 없으면 보류
      const isLlmGround = e.rel === "업무근거" && e.props?.basis !== "전결" && e.provenance?.method === "llm";
      if (isLlmGround && !WITH_LLM) {
        heldN++;
        held.push(`${t.label} ← ${e.rel}(${e.props?.basis},llm) 보류(--with-llm-grounds로 포함)`);
        continue;
      }
      // 선행(정책→집행)은 상대 Task도 승격 대상일 때만(candidate 노드로의 promoted 엣지 방지)
      if (e.rel === "선행" && !(typeof e.to === "string" && pilotIds.has(e.to))) {
        heldN++;
        held.push(`${t.label} ← 선행 보류: 상대 업무 미승격(${String(e.to).replace("task:", "")})`);
        continue;
      }
      const gate = canPromoteEdge(e);
      if (!gate.ok) {
        heldN++;
        held.push(`${t.label} ← ${e.rel} 보류: ${gate.reason}`);
        continue;
      }
      if (!DRY)
        await OntologyEdgeModel.updateOne(
          { _id: e._id },
          { $set: { status: "promoted", "provenance.reviewedBy": "human", "provenance.reviewedAt": AT } },
        );
      edgeN++;
      if (typeof e.to === "string") nodeIds.add(e.to); // 조직축 노드(Dept/Position) 함께 승격
    }
  }

  // 양단 노드 승격(존재하는 것만 — corpus 앵커는 노드 아님)
  let nodeN = 0;
  if (!DRY) {
    const r = await OntologyNodeModel.updateMany(
      { id: { $in: [...nodeIds] } },
      { $set: { status: target, "provenance.reviewedBy": "human", "provenance.reviewedAt": AT } },
    );
    nodeN = r.modifiedCount;
  } else nodeN = nodeIds.size;

  console.log(`[${DEMOTE ? "강등" : "승격"}] Task ${tasks.length} · 노드 ${nodeN}(${target}) · 엣지 ${edgeN}`);
  if (heldN) {
    console.log(`  보류 ${heldN}건:`);
    for (const h of held.slice(0, 30)) console.log(`   · ${h}`);
    if (held.length > 30) console.log(`   … 외 ${held.length - 30}`);
  }
  if (DRY) console.log("  (dry — 미반영)");
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
