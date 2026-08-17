import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";
import mongoose from "mongoose";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { taskProfile } from "@/lib/ontology-query";
import { connectDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/work100/task/[id] — 온톨로지 패널 데이터(무로그인 공개).
 * 소관·전결(한도)·근거를 evidence·status와 함께. all=true로 candidate 포함(패널이 상태 배지 표시).
 * boardId·hasBoard(보드 모달 진입) 포함.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = decodeURIComponent(id);
  await connectDb();

  const node = await OntologyNodeModel.findOne({ id: taskId, type: "Task" })
    .select("id label status props")
    .lean<{ id: string; label: string; status?: string; props?: { dept?: string; desc?: string; fn?: string; org?: string; steps?: string[]; linkedToHQ?: string | null; alsoDepts?: string[] } }>();
  if (!node) return NextResponse.json({ error: "업무 없음" }, { status: 404 });

  const profile = await taskProfile(taskId, { all: true });

  // 보드 렌더캐시 유무(svg만 조회 — 본문은 board API에서)
  let hasBoard = false;
  const db = mongoose.connection?.db;
  if (db) {
    const b = await db.collection("work100_boards").findOne({ taskId }, { projection: { _id: 0, svg: 1 } });
    hasBoard = Boolean(b?.svg);
  }

  recordUsage("knowledge", "work"); // 업무 상세 패널 열람
  return NextResponse.json({
    task: {
      id: node.id, label: node.label, dept: node.props?.dept ?? "", desc: node.props?.desc ?? "",
      status: node.status ?? "candidate", fn: node.props?.fn ?? "", org: node.props?.org ?? "본사",
      steps: node.props?.steps ?? [], linkedToHQ: node.props?.linkedToHQ ?? null, alsoDepts: node.props?.alsoDepts ?? [],
    },
    ownership: profile.ownership,
    approval: profile.approval,
    basis: profile.basis,
    hasBoard,
    boardId: hasBoard ? taskId : null,
  });
}
