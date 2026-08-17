/**
 * 예전 internalregulations(articles[]) → rag_regulation(title, content, year, articles[]).
 * 실행: npx tsx src/scripts/migrate-internalregulations-to-rag.ts
 * 이미 rag_regulation에 문서가 있으면 종료 (FORCE_MIGRATE_RAG=1 이면 삭제 후 재이관)
 */
import "./load-env";
import mongoose from "mongoose";
import { env } from "../lib/env";
import { buildRegulationContentFromArticles } from "../lib/regulations-content";
import { RagRegulationModel } from "../models/RagRegulation";
import { collectionName } from "@/lib/collections";

type OldDoc = {
  _id: unknown;
  title?: string;
  revisionInfo?: string;
  articles?: { name?: string; fullText?: string }[];
};

async function main() {
  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10 });
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");

  const oldNames = await db.listCollections().toArray();
  const hasOld = oldNames.some((c) => c.name === collectionName("internalRegulations"));
  if (!hasOld) {
    console.log("[migrate] internalregulations 컬렉션이 없습니다. 종료.");
    await mongoose.disconnect();
    return;
  }

  const existingNew = await RagRegulationModel.estimatedDocumentCount();
  if (existingNew > 0 && process.env.FORCE_MIGRATE_RAG !== "1" && process.env.FORCE_MIGRATE_RAG !== "true") {
    console.log(
      `[migrate] rag_regulation에 이미 ${existingNew}건 있습니다. 덮어쓰려면 FORCE_MIGRATE_RAG=1 을 설정하세요.`
    );
    await mongoose.disconnect();
    return;
  }

  if (existingNew > 0) {
    await RagRegulationModel.deleteMany({});
    console.log("[migrate] 기존 rag_regulation 문서 삭제.");
  }

  const raw = db.collection(collectionName("internalRegulations"));
  const cursor = raw.find({}) as AsyncIterable<OldDoc>;
  let n = 0;
  for await (const d of cursor) {
    const title = String(d.title ?? "").trim() || "(제목없음)";
    const year = String(d.revisionInfo ?? "").trim();
    const articles = Array.isArray(d.articles)
      ? d.articles.map((a, i) => ({
          name: String(a.name ?? "").trim() || "조항",
          fullText: typeof a.fullText === "string" ? a.fullText : "",
          order: i,
        }))
      : [];
    const content = buildRegulationContentFromArticles(title, year, articles);
    await RagRegulationModel.create({
      title,
      year,
      content,
      articles,
      metadata: {
        articleCount: articles.length,
        source: "migrated-from-internalregulations",
        migratedFrom: String(d._id),
      },
      embedding: null,
    });
    n++;
  }

  console.log(`[migrate] 완료: ${n}건을 rag_regulation로 이관했습니다.`);
  console.log("[migrate] 선택: internalregulations 컬렉션은 백업용으로 보관하거나 Atlas/로컬에서 수동 삭제할 수 있습니다.");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
