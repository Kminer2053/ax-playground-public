/** 대형 별표 임베딩 백필(감사 R1) — 본문은 있는데 rag_vectors에 없는 조문(임베딩 한도 초과로
 *  조용히 실패했던 30건)을 창(≤3,500자) 분할 임베딩 후 평균 풀링해 단일 벡터로 저장한다.
 *  h는 graph-build hashOf(name, 정규화 본문)와 동일 계산 — 이후 재적재 시 증분 재사용 가능.
 *  실행: set -a; source .env.local; set +a; npx tsx src/scripts/backfill-large-embeddings.ts [--apply]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { getEmbedding } from "@/lib/embedding";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { collectionName } from "@/lib/collections";

const APPLY = process.argv.includes("--apply");
const WIN = 3500;   // 실패 경계 실측 최소 6,339자 — 안전 마진 창 크기
const MAX_WIN = 12; // 42,397자 최장 별표도 12창 이내

const hashOf = (name: string, normBody: string) => createHash("sha1").update(`${name}\n${normBody}`).digest("hex").slice(0, 24);

async function main() {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");
  const cfg = await getPlaygroundConfig();
  const vcol = db.collection(collectionName("ragVectors"));

  const docs = (await RagRegulationModel.find({}, { title: 1, category: 1, articles: 1 }).lean()) as {
    title?: string; category?: string; articles?: { name?: string; fullText?: string; tableGloss?: string }[];
  }[];
  const have = new Set((await vcol.find({}, { projection: { doc: 1, ci: 1 } }).toArray()).map((v) => `${v.doc}#${v.ci}`));

  type T = { doc: string; ci: number; name: string; cat: string; body: string; gloss: string };
  const targets: T[] = [];
  for (const d of docs) {
    (d.articles ?? []).forEach((a, i) => {
      const body = (a.fullText ?? "").trim();
      if (!body || have.has(`${d.title}#${i}`)) return;
      targets.push({ doc: d.title ?? "", ci: i, name: (a.name ?? "").trim(), cat: d.category ?? "", body, gloss: (a.tableGloss ?? "").trim() });
    });
  }
  console.log(`백필 대상: ${targets.length}건 (본문 있음 · 벡터 없음)`);
  for (const t of targets) console.log(`  - ${t.doc} #${t.ci} ${t.name} (${t.body.length.toLocaleString()}자${t.gloss ? " · gloss" : ""})`);
  if (!APPLY) { console.log("\n(dry-run — 실제 반영은 --apply)"); await mongoose.disconnect(); return; }

  let okN = 0, failN = 0;
  for (const t of targets) {
    const wins: string[] = [];
    for (let p = 0; p < t.body.length && wins.length < MAX_WIN; p += WIN) wins.push(t.body.slice(p, p + WIN));
    const vecs: number[][] = [];
    for (let wi = 0; wi < wins.length; wi++) {
      const text = wi === 0 ? `${t.name}\n${t.gloss ? t.gloss.slice(0, 2000) + "\n" : ""}${wins[wi]}` : `${t.name}\n${wins[wi]}`;
      const v = await getEmbedding(text, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
      if (v) vecs.push(v);
    }
    if (!vecs.length) { failN++; console.warn(`  ✗ 임베딩 실패: ${t.doc} #${t.ci} ${t.name}`); continue; }
    const dim = vecs[0].length;
    const mean = new Array<number>(dim).fill(0);
    for (const v of vecs) for (let i = 0; i < dim; i++) mean[i] += v[i] / vecs.length;
    const h = hashOf(t.name, t.body.replace(/\s+/g, " ").trim());
    await vcol.insertOne({ doc: t.doc, ci: t.ci, name: t.name, cat: t.cat, vec: mean, h });
    okN++;
    console.log(`  ✓ ${t.doc} #${t.ci} ${t.name} (${vecs.length}창 평균)`);
  }
  console.log(`\n완료: 성공 ${okN} / 실패 ${failN} · rag_vectors 총 ${await vcol.countDocuments()}건`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
