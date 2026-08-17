import { NextResponse } from "next/server";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { OntologyEdgeModel } from "@/models/OntologyEdge";
import { NOT_STALE } from "@/lib/ontology-query";
import { connectDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/work100/map — 업무탐색 3D 지도 데이터(무로그인 공개).
 * 전체 111업무(promoted/candidate 구분) + 부서 + 부서상하(통로 위상) + 공유 근거(협업 프록시).
 * 좌표는 미포함 — 클라이언트 레이아웃 생성기가 배치(순수 데이터 API).
 */
type DeptDoc = { id: string; label: string; status?: string; props?: { deptPath?: string; honbu?: string; kind?: string; order?: number } };
type TaskDoc = { id: string; label: string; status?: string; props?: { dept?: string; desc?: string; fn?: string; org?: string } };

export async function GET() {
  await connectDb();

  const [deptDocs, taskDocs] = await Promise.all([
    OntologyNodeModel.find({ type: "Dept" }).select("id label status props").lean<DeptDoc[]>(),
    OntologyNodeModel.find({ type: "Task" }).select("id label status props").lean<TaskDoc[]>(),
  ]);

  // 부서상하(본부→처): 통로 위상
  const hierEdges = await OntologyEdgeModel.find({ rel: "부서상하", ...NOT_STALE })
    .select("from to")
    .lean<{ from: string; to: unknown }[]>();

  // 부서별 업무 수(포켓 밀도)
  const taskCountByDept = new Map<string, number>();
  for (const t of taskDocs) {
    const d = t.props?.dept ?? "";
    taskCountByDept.set(d, (taskCountByDept.get(d) ?? 0) + 1);
  }

  const depts = deptDocs.map((d) => ({
    id: d.id,
    label: d.label,
    honbu: d.props?.honbu ?? "",
    deptPath: d.props?.deptPath ?? "",
    kind: d.props?.kind ?? "",
    order: d.props?.order ?? 0,
    taskCount: taskCountByDept.get(d.label) ?? 0,
  }));

  const tasks = taskDocs.map((t) => ({
    id: t.id,
    label: t.label,
    dept: t.props?.dept ?? "",
    desc: t.props?.desc ?? "",
    fn: t.props?.fn ?? "",
    org: t.props?.org ?? "본사",
    status: t.status ?? "candidate",
  }));

  const deptEdges = hierEdges
    .filter((e) => e.from && e.to)
    .map((e) => [e.from, String(e.to)] as [string, string]);

  // 협업 프록시 — 같은 근거 규정(위임전결 제외)을 공유하는 업무 그룹
  const crossGroups = await OntologyEdgeModel.aggregate([
    { $match: { rel: "업무근거", "evidence.doc": { $ne: "위임전결규정" }, ...NOT_STALE } },
    { $group: { _id: "$evidence.doc", tasks: { $addToSet: "$from" } } },
    { $project: { doc: "$_id", tasks: 1, n: { $size: "$tasks" } } },
    { $match: { n: { $gte: 2, $lte: 12 } } }, // 2~12업무: 너무 큰 규정(클리크 폭발)·단독은 제외
    { $sort: { n: -1 } },
    { $limit: 40 },
  ]);
  const crossLinks = crossGroups.map((g: { doc: string; tasks: string[] }) => ({ doc: g.doc, tasks: g.tasks }));

  // 선행(본사 정책 → 현업 집행) — 포켓을 가로지르는 정책-집행 연결선
  const precedes = (await OntologyEdgeModel.find({ rel: "선행", ...NOT_STALE })
    .select("from to")
    .lean<{ from: string; to: unknown }[]>())
    .filter((e) => e.from && typeof e.to === "string")
    .map((e) => [e.from, String(e.to)] as [string, string]);

  const promoted = tasks.filter((t) => t.status === "promoted").length;
  return NextResponse.json({
    depts,
    tasks,
    deptEdges,
    crossLinks,
    precedes,
    stats: { depts: depts.length, tasks: tasks.length, promoted, candidate: tasks.length - promoted, crossLinks: crossLinks.length, precedes: precedes.length },
  });
}
