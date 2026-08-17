/**
 * 지식자산 상태 캐시 백필 — 전 문서의 파이프라인 단계별 상태를 집계해 `asset_status`에 기록.
 *
 * 집계 자체는 `src/lib/asset-status.ts`가 하고, 이 스크립트는 전량 순회 + 요약 보고만 한다.
 * 적재 라우트·CLI도 같은 함수를 쓰므로 결과가 갈라지지 않는다.
 *
 * 사용(MONGODB_DB가 URI 경로보다 우선하므로 둘 다 지정):
 *   MONGODB_URI="mongodb://127.0.0.1:27017" MONGODB_DB="axplayground" npm run assets:backfill
 *   npm run assets:backfill -- --fix-hash   # 해시 누락·레거시 조문을 현행 규약으로 채우고 집계
 *   npm run assets:backfill -- --analyze    # 근거 영향도 함께 판정(어긋난 근거를 격리) — 초기 1회 기준선용
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";
import { computeAssetStatus, saveAssetStatus, pruneAssetStatus, ensureArticleHashes, ensureAssetStatusIndex, type AssetStatus } from "@/lib/asset-status";
import { analyzeOntologyImpact, type ImpactResult } from "@/lib/ontology-impact";

const FIX_HASH = process.argv.includes("--fix-hash");
const ANALYZE = process.argv.includes("--analyze");

async function main() {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결 실패");

  await ensureAssetStatusIndex();
  const titles = (await db.collection(collectionName("ragRegulation")).distinct("title")).sort();
  console.log(`대상 ${titles.length}문서${FIX_HASH ? " (--fix-hash: 해시 보정 포함)" : ""}`);

  const done: AssetStatus[] = [];
  const impacts: ImpactResult[] = [];
  let hashFixed = 0;
  for (const [i, t] of titles.entries()) {
    if (FIX_HASH) hashFixed += await ensureArticleHashes(t);
    // 영향 판정은 해시 보정 뒤, 상태 집계 앞 — 방금 세운 격리가 집계에 반영되도록.
    if (ANALYZE) impacts.push(await analyzeOntologyImpact(t));
    const s = await computeAssetStatus(t);
    if (!s) continue;
    await saveAssetStatus(s);
    done.push(s);
    if (process.stdout.isTTY) process.stdout.write(`\r  ${i + 1}/${titles.length}`);
  }
  if (process.stdout.isTTY) process.stdout.write("\n");

  const pruned = await pruneAssetStatus();

  // ── 요약 ──
  const sum = (f: (s: AssetStatus) => number) => done.reduce((a, s) => a + f(s), 0);
  const attention = done.filter((s) => s.health === "attention");
  console.log(`\n기록 ${done.length}건${pruned ? ` · 유령 캐시 ${pruned}건 삭제` : ""}${FIX_HASH ? ` · 해시 보정 ${hashFixed}조문` : ""}`);
  console.log(`  조문 ${sum((s) => s.articles.count).toLocaleString()} · 임베딩 커버 ${sum((s) => s.embedding.covered).toLocaleString()}`);
  console.log(`  그래프 참조 ${sum((s) => s.graph.refOut)} · 법령 ${sum((s) => s.graph.law)} · 위계 ${sum((s) => s.graph.hierUp)}`);
  console.log(`  표 ${sum((s) => s.tables.count)} · 업무근거 엣지 ${sum((s) => s.ontology.edges)}(재검토 ${sum((s) => s.ontology.stale)})`);

  if (ANALYZE) {
    const staled = impacts.flatMap((r) => r.staled);
    const restored = impacts.reduce((a, r) => a + r.restored.length, 0);
    const migrated = impacts.reduce((a, r) => a + r.migrated, 0);
    const tasks = new Set(staled.map((s) => s.task));
    console.log(`  영향 판정 — 신규 격리 ${staled.length}(업무 ${tasks.size}개) · 해제 ${restored} · 해시규약 갱신 ${migrated}`);
  }

  console.log(`\n조치 필요 ${attention.length}문서`);
  for (const s of attention.slice(0, 15)) console.log(`  · ${s.title} — ${s.issues.join(" / ")}`);
  if (attention.length > 15) console.log(`  … 외 ${attention.length - 15}건`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
