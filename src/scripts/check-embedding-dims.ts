/**
 * rag_regulation 문서의 embedding 필드 분포 (선택 필드, 회수 경로에서는 미사용).
 * 실행: npx tsx src/scripts/check-embedding-dims.ts
 */
import "./load-env";
import mongoose from "mongoose";
import { env } from "../lib/env";
import { RagRegulationModel } from "../models/RagRegulation";

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const total = await RagRegulationModel.estimatedDocumentCount();
  const withEmb = await RagRegulationModel.countDocuments({
    embedding: { $exists: true, $type: "array", $not: { $size: 0 } },
  });
  console.log("rag_regulation 총 문서:", total);
  console.log("embedding 배열이 비어 있지 않은 문서:", withEmb);
  console.log("참조 구조와 동일: QA 회수는 $text+키워드만 사용하며 임베딩은 필수 아님.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
