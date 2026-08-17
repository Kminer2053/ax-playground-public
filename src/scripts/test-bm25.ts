/** BM25 동작 검증 — 인덱스 빌드 + 토크나이저 + 상위 문서 확인. npx tsx src/scripts/test-bm25.ts */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { bm25SearchTitles, tokenizeKo } from "@/lib/regulations-bm25";

async function main() {
  await connectDb();
  console.log("tokenize('연차휴가를'):", tokenizeKo("연차휴가를"));
  for (const q of ["연차휴가는 며칠인가요?", "상품권 구매 대금 회계처리", "갑질 당하면 어디에 신고하나요?", "출장 여비 지급 기준", "징계 종류"]) {
    const r = await bm25SearchTitles(q, 5);
    console.log("\nQ:", q);
    r.forEach((x) => console.log("   " + x.score.toFixed(2).padStart(6), x.title));
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
