/**
 * 지식자산 현황 — 문서별 파이프라인 상태 목록 + 전체 요약.
 *
 * `asset_status` 캐시를 읽는다. 캐시는 적재 파이프라인이 갱신하지만, 라우트를 거치지 않는
 * 스크립트로 DB가 바뀌면 낡을 수 있다. `?refresh=1`이면 현재 DB에서 전량 재집계한다
 * (212문서 기준 수 초 — 화면의 [새로 집계] 버튼용).
 */
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { isAdmin } from "@/lib/adminAuth";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";
import { computeAssetStatus, saveAssetStatus, pruneAssetStatus, ensureAssetStatusIndex, type AssetStatus } from "@/lib/asset-status";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) return NextResponse.json({ error: "db" }, { status: 500 });

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh) {
    await ensureAssetStatusIndex();
    const titles = await db.collection(collectionName("ragRegulation")).distinct("title");
    for (const t of titles) {
      const s = await computeAssetStatus(t);
      if (s) await saveAssetStatus(s);
    }
    await pruneAssetStatus();
  }

  const rows = (await db
    .collection(collectionName("assetStatus"))
    .find({}, { projection: { _id: 0 } })
    .toArray()) as unknown as AssetStatus[];

  // 조치 필요 우선, 그다음 업무 참조가 많은 순 — 관리자가 먼저 볼 것을 위로.
  rows.sort((a, b) => {
    if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
    return b.ontology.tasks - a.ontology.tasks;
  });

  const sum = (f: (s: AssetStatus) => number) => rows.reduce((n, s) => n + f(s), 0);
  const internal = rows.filter((s) => !s.external);

  // 업무·보드는 여러 문서를 근거로 삼으므로 문서별 값을 더하면 중복된다(업무 169가 450으로 부풀었다).
  // 전체 합계는 컬렉션에서 직접 센다.
  const [taskTotal, boardTotal] = await Promise.all([
    db.collection(collectionName("ontologyNodes")).countDocuments({ type: "Task" }),
    db.collection(collectionName("work100Boards")).countDocuments(),
  ]);
  const summary = {
    docs: { total: rows.length, internal: internal.length, external: rows.length - internal.length },
    articles: sum((s) => s.articles.count),
    // 임베딩은 외부 규범을 제외한 값이라야 의미가 있다(법령은 검색 격리 대상).
    embedding: { covered: sum((s) => s.embedding.covered), total: internal.reduce((n, s) => n + s.embedding.total, 0) },
    graph: { ref: sum((s) => s.graph.refOut), law: sum((s) => s.graph.law), hier: sum((s) => s.graph.hierUp) },
    tables: sum((s) => s.tables.count),
    ontology: {
      edges: sum((s) => s.ontology.edges),
      stale: sum((s) => s.ontology.stale),
      mismatch: sum((s) => s.ontology.mismatch.changed + s.ontology.mismatch.missing),
      tasks: taskTotal,
    },
    boards: boardTotal,
    attention: rows.filter((s) => s.health === "attention").length,
    computedAt: rows.reduce<string | null>((m, s) => {
      const t = s.computedAt ? new Date(s.computedAt).toISOString() : null;
      return !m || (t && t < m) ? t : m;   // 가장 오래된 집계 시각 = 이 화면이 얼마나 낡았나
    }, null),
  };

  return NextResponse.json({ ok: true, summary, rows });
}
