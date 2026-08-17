/**
 * public/sagyu.json 재생성 — DB(rag_regulation) 기준.
 * 배포서버에서 RAG DB만 부분 업데이트(update-rag-db)한 뒤 좌측 사규 검색 목록을 동기화할 때 사용.
 *   MONGODB_URI=mongodb://127.0.0.1:27017/axplayground npm run sagyu:build
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { buildSagyuFromDb } from "@/lib/regulations-sagyu";

async function main() {
  await connectDb();
  const n = await buildSagyuFromDb();
  console.log(`✓ public/sagyu.json 재생성 — 사규 ${n}건`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
