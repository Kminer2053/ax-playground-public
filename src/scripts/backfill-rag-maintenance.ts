/** RAG 데이터 정합 유지보수(감사 R9·R12) — 3종 일괄:
 *  (a) arthash 백필: '엣지 0개' 조문 해시 메타를 전 문서에 생성(재적재 시 gemma 재도출 드리프트 방지).
 *      graph-build updateGraphForDoc L200-244와 동일 의미론(hashOf(name, 정규화 본문)).
 *  (b) rag_vectors name 끝공백 trim(4건) — 벡터 조문힌트가 raw name 매칭이라 미스나던 결함.
 *  (c) ref/tt:doc 중복 엣지 dedupe(동일 sdoc·sci·tdoc·rt) — 그래프 확장 점수 이중 가산 제거.
 *  실행: set -a; source .env.local; set +a; npx tsx src/scripts/backfill-rag-maintenance.ts [--apply]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import { createHash } from "node:crypto";
import mongoose, { type Types } from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { collectionName } from "@/lib/collections";

const APPLY = process.argv.includes("--apply");
const hashOf = (name: string, normBody: string) => createHash("sha1").update(`${name}\n${normBody}`).digest("hex").slice(0, 24);

async function main() {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");
  const ecol = db.collection(collectionName("ragGraphEdges"));
  const vcol = db.collection(collectionName("ragVectors"));

  // (a) arthash 백필
  const docs = (await RagRegulationModel.find({}, { title: 1, articles: 1 }).lean()) as {
    title?: string; articles?: { name?: string; fullText?: string }[];
  }[];
  const haveMeta = new Set((await ecol.find({ kind: "arthash" }, { projection: { sdoc: 1 } }).toArray()).map((e) => String(e.sdoc)));
  let metaNew = 0;
  for (const d of docs) {
    const title = d.title ?? "";
    if (!title || haveMeta.has(title)) continue;
    const arts = d.articles ?? [];
    const withEdge = new Set(
      (await ecol.find({ sdoc: title, kind: { $in: ["ref", "law"] } }, { projection: { sci: 1 } }).toArray()).map((e) => Number(e.sci)),
    );
    const noEdgeHashes = arts
      .map((a, i) => ({ a, i }))
      .filter(({ i }) => !withEdge.has(i))
      .map(({ a }) => hashOf((a.name ?? "").trim() ? (a.name as string) : "", (a.fullText ?? "").replace(/\s+/g, " ").trim()));
    metaNew++;
    if (APPLY) await ecol.replaceOne({ kind: "arthash", sdoc: title }, { kind: "arthash", sdoc: title, hashes: noEdgeHashes }, { upsert: true });
  }
  console.log(`(a) arthash 백필: 기존 ${haveMeta.size} → 신규 ${metaNew}건${APPLY ? " 반영" : " (dry)"}`);

  // (b) rag_vectors name 끝공백 trim
  const vrows = (await vcol.find({}, { projection: { name: 1 } }).toArray()) as { _id: Types.ObjectId; name?: string }[];
  const dirty = vrows.filter((v) => typeof v.name === "string" && v.name !== v.name.trim());
  for (const v of dirty) if (APPLY) await vcol.updateOne({ _id: v._id }, { $set: { name: (v.name as string).trim() } });
  console.log(`(b) name trim: ${dirty.length}건${APPLY ? " 반영" : " (dry)"}`);

  // (c) ref/tt:doc 중복 dedupe — 동일 (sdoc,sci,tdoc,rt) 그룹에서 첫 건만 보존
  const dups = (await ecol
    .aggregate([
      { $match: { kind: "ref", tt: "doc" } },
      { $group: { _id: { sdoc: "$sdoc", sci: "$sci", tdoc: "$tdoc", rt: "$rt" }, ids: { $push: "$_id" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray()) as { ids: Types.ObjectId[]; n: number }[];
  let removed = 0;
  for (const g of dups) {
    const drop = g.ids.slice(1);
    removed += drop.length;
    if (APPLY) await ecol.deleteMany({ _id: { $in: drop } });
  }
  console.log(`(c) ref/doc 중복 엣지: ${dups.length}그룹 ${removed}건 제거${APPLY ? " 반영" : " (dry)"}`);
  if (!APPLY) console.log("\n(dry-run — 실제 반영은 --apply)");
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
