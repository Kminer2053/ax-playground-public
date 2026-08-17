/**
 * 지식검색 사규 DB 백업 — 라이브 rag_regulation 전체를 타임스탬프 JSON으로 덤프.
 * DB 재구축 전 안전 스냅샷용. 실행: npm run backup:regulations
 * 출력: backups/regulations-YYYYMMDD-HHMM.json
 */
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI가 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}
const MONGODB_DB = (process.env.MONGODB_DB || "").trim() || "axplayground";

import mongoose from "mongoose";
import { RagRegulationModel } from "../models/RagRegulation";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  await mongoose.connect(MONGODB_URI!, { dbName: MONGODB_DB });
  const docs = await RagRegulationModel.find({}).lean();
  let arts = 0;
  for (const d of docs) arts += Array.isArray((d as { articles?: unknown[] }).articles) ? (d as { articles: unknown[] }).articles.length : 0;

  const backup = {
    _meta: {
      kind: "rag-regulation-backup",
      exportedAt: new Date().toISOString(),
      db: MONGODB_DB,
      counts: { documents: docs.length, articles: arts },
    },
    regulations: docs,
  };

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `regulations-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), "utf8");

  console.log(`사규 DB 백업 완료 → ${path.relative(process.cwd(), file)}`);
  console.log(`  규정 ${docs.length}건, 조문 ${arts}개 (db=${MONGODB_DB}, ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)}MB)`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("백업 실패:", e);
  process.exit(1);
});
