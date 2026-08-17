/**
 * 사규 청크 임베딩 생성 → MongoDB `rag_vectors` 컬렉션.
 * 런타임 하이브리드 시드(벡터+$text)용. 실행: env 인라인으로 OLLAMA_EMBEDDING_MODEL/DIMENSIONS 지정 권장.
 *   MONGODB_URI=... OLLAMA_EMBEDDING_MODEL=bge-m3 EMBEDDING_DIMENSIONS=1024 npx tsx src/scripts/build-embeddings.ts
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { getEmbedding, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "@/lib/embedding";

type Task = { doc: string; ci: number; name: string; cat: string; text: string };

async function main() {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");
  console.log(`모델 ${EMBEDDING_MODEL} / 차원 ${EMBEDDING_DIMENSIONS}`);

  const docs = (await RagRegulationModel.find({}, { title: 1, category: 1, articles: 1 }).lean()) as {
    title?: string; category?: string; articles?: { name?: string; fullText?: string }[];
  }[];
  const tasks: Task[] = [];
  for (const d of docs) {
    (d.articles ?? []).forEach((a, i) => {
      const name = (a.name ?? "").trim();
      const body = (a.fullText ?? "").trim();
      if (!body) return; // 구분자(빈 본문) 제외
      tasks.push({ doc: d.title ?? "", ci: i, name, cat: d.category ?? "", text: `${name}\n${body}` });
    });
  }
  console.log("임베딩 대상 청크:", tasks.length);

  const CONC = 6;
  const results: { doc: string; ci: number; name: string; cat: string; vec: number[] }[] = [];
  let done = 0, fail = 0;
  const slices: Task[][] = Array.from({ length: CONC }, () => []);
  tasks.forEach((t, i) => slices[i % CONC].push(t));
  await Promise.all(
    slices.map(async (slice) => {
      for (const t of slice) {
        const vec = await getEmbedding(t.text);
        done++;
        if (vec) results.push({ doc: t.doc, ci: t.ci, name: t.name, cat: t.cat, vec });
        else fail++;
        if (done % 300 === 0) console.log(`  ${done}/${tasks.length} (실패 ${fail})`);
      }
    }),
  );
  console.log(`임베딩 완료: 성공 ${results.length} / 실패 ${fail}`);

  const col = db.collection("rag_vectors");
  await col.deleteMany({});
  for (let i = 0; i < results.length; i += 500) await col.insertMany(results.slice(i, i + 500));
  await col.createIndex({ doc: 1, ci: 1 });
  console.log("rag_vectors 저장:", await col.countDocuments());
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
