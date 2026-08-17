/**
 * 사규 텍스트 인덱스 재생성 전 기존 text 인덱스 삭제.
 * 실행: npx tsx src/scripts/fix-regulations-index.ts
 */
import "./load-env";
import mongoose from "mongoose";
import { env } from "../lib/env";
import { RagRegulationModel } from "../models/RagRegulation";

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const coll = RagRegulationModel.collection;
  const indexes = await coll.indexes();

  const toDrop = indexes.find(
    (i) => i.name && i.name !== "_id_" && (i.name.includes("text") || (i.key as Record<string, string>)?.["$**"])
  );
  if (toDrop?.name) {
    await coll.dropIndex(toDrop.name);
    console.log("Dropped index:", toDrop.name, "- Restart the app to create the new index.");
  } else {
    console.log("No text index to drop. Run seed:regulations if collection is empty.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
