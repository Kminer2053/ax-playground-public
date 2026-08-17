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
import { collectionName } from "@/lib/collections";

type Task = { doc: string; ci: number; name: string; cat: string; text: string; body: string };

async function main() {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");
  console.log(`모델 ${EMBEDDING_MODEL} / 차원 ${EMBEDDING_DIMENSIONS}`);

  const docs = (await RagRegulationModel.find({}, { title: 1, category: 1, articles: 1 }).lean()) as {
    title?: string; category?: string; articles?: { name?: string; fullText?: string; tableGloss?: string }[];
  }[];
  const tasks: Task[] = [];
  for (const d of docs) {
    (d.articles ?? []).forEach((a, i) => {
      const name = (a.name ?? "").trim();
      const body = (a.fullText ?? "").trim();
      if (!body) return; // 구분자(빈 본문) 제외
      // 표 해석(tableGloss)이 있으면 명제를 앞세워 임베딩 — 파이프 위주 별표의 의미 밀도 보강(build-table-gloss와 동일 순서)
      const gloss = (a.tableGloss ?? "").trim();
      tasks.push({ doc: d.title ?? "", ci: i, name, cat: d.category ?? "", text: gloss ? `${name}\n${gloss}\n${body}` : `${name}\n${body}`, body });
    });
  }
  console.log("임베딩 대상 청크:", tasks.length);

  const CONC = 6;
  // h(이름+정규화 본문 해시) 동봉 — 재적재 증분(updateGraphForDoc)이 h로 무변경 판정해 임베딩을 재사용.
  // 기존엔 h 미기록이라 이 스크립트를 한 번 돌리면 증분 재사용이 전멸했다(감사 R9).
  const { createHash } = await import("node:crypto");
  const hashOf = (name: string, body: string) => createHash("sha1").update(`${name}\n${body.replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);
  const results: { doc: string; ci: number; name: string; cat: string; vec: number[]; h: string }[] = [];
  const failed: Task[] = [];
  let done = 0;
  const slices: Task[][] = Array.from({ length: CONC }, () => []);
  tasks.forEach((t, i) => slices[i % CONC].push(t));
  await Promise.all(
    slices.map(async (slice) => {
      for (const t of slice) {
        const vec = await getEmbedding(t.text);
        done++;
        if (vec) results.push({ doc: t.doc, ci: t.ci, name: t.name, cat: t.cat, vec, h: hashOf(t.name, t.body) });
        else failed.push(t);
        if (done % 300 === 0) console.log(`  ${done}/${tasks.length} (실패 ${failed.length})`);
      }
    }),
  );
  console.log(`임베딩 완료: 성공 ${results.length} / 실패 ${failed.length}`);
  // 실패를 이름까지 노출 — 대형 별표가 무경고 누락되던 조용한 실패 제거(감사 R1). 백필: backfill-large-embeddings.ts
  for (const t of failed) console.warn(`  ✗ 실패: ${t.doc} #${t.ci} ${t.name} (${t.text.length.toLocaleString()}자)`);

  const col = db.collection(collectionName("ragVectors"));
  await col.deleteMany({});
  for (let i = 0; i < results.length; i += 500) await col.insertMany(results.slice(i, i + 500));
  await col.createIndex({ doc: 1, ci: 1 });
  console.log("rag_vectors 저장:", await col.countDocuments());
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
