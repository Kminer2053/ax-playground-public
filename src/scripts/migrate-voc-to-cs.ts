/**
 * 일회성 마이그레이션: 가드 패널 키 voc → cs 통일에 따른 기존 데이터 보존 이전.
 *  - AuditLog.panel: "voc" → "cs"
 *  - PlaygroundConfig.featureModels.voc → .cs (패널별 모델 매핑 보존)
 * 실행: npm run migrate:voc-to-cs
 * 멱등: 재실행 시 voc가 없으면 0건 변경.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import mongoose from "mongoose";
import { collectionName } from "@/lib/collections";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI가 없습니다. .env.local 또는 환경 변수를 설정하세요.");
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI as string);
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결에 실패했습니다.");

  // 1) AuditLog.panel: voc → cs
  const audit = await db.collection(collectionName("auditLogs")).updateMany({ panel: "voc" }, { $set: { panel: "cs" } });
  console.log(`[AuditLog]  panel voc→cs : matched=${audit.matchedCount} modified=${audit.modifiedCount}`);

  // 2) PlaygroundConfig.featureModels.voc → .cs (모델 매핑 보존)
  const cfgColl = db.collection(collectionName("playgroundConfigs"));
  const cfg = await cfgColl.findOne({ key: "default" });
  const fm = (cfg?.featureModels ?? null) as Record<string, unknown> | null;
  if (fm && Object.prototype.hasOwnProperty.call(fm, "voc")) {
    const next = { ...fm };
    if (next.cs === undefined) next.cs = next.voc; // 이미 cs가 있으면 cs 우선(보존)
    delete next.voc;
    await cfgColl.updateOne({ key: "default" }, { $set: { featureModels: next } });
    console.log(`[PlaygroundConfig]  featureModels.voc→cs 이전 완료 (모델="${String(fm.voc)}")`);
  } else {
    console.log("[PlaygroundConfig]  featureModels.voc 없음 — 이전 불필요");
  }

  await mongoose.disconnect();
  console.log("마이그레이션 완료.");
}

main().catch((e) => {
  console.error("마이그레이션 실패:", e);
  process.exit(1);
});
