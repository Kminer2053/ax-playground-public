/** ref 재타이핑 결과(/tmp/ref_typed.json)를 DB 반영. ref/master.json(idx→_id). rt+reason+rtConf, rt_old 백업.
 *  MONGODB_URI=... npx tsx src/scripts/write-ref-typed.ts [--write]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";

const DIR = path.join(process.env.GEDGE_DIR || path.join(process.cwd(), "data/tmp/gedge"), "ref");
const WRITE = process.argv.includes("--write");

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const master = JSON.parse(fs.readFileSync(`${DIR}/master.json`, "utf8")) as { idx: number; _id: string }[];
  const id2 = new Map(master.map((m) => [m.idx, m._id]));
  const typed = JSON.parse(fs.readFileSync("/tmp/ref_typed.json", "utf8")) as { idx: number; rt: string; rationale: string; conf: string }[];
  const { ObjectId } = await import("mongodb");
  let miss = 0;
  const ops: Record<string, unknown>[] = [];
  for (const t of typed) {
    const id = id2.get(t.idx);
    if (!id) { miss++; continue; }
    ops.push({ updateOne: { filter: { _id: new ObjectId(id) },
      update: [{ $set: { rt_old: { $ifNull: ["$rt_old", "$rt"] } } },
               { $set: { rt: t.rt || "미상", reason: t.rationale ?? "", rtConf: t.conf ?? "하" } }] } });
  }
  console.log(`ref 타이핑 ${typed.length}건 (id매칭실패 ${miss})`);
  if (!WRITE) { console.log("(리포트만 — --write)"); await mongoose.disconnect(); return; }
  const res = await db.collection(collectionName("ragGraphEdges")).bulkWrite(ops as unknown as never[]);
  console.log(`DB 반영: ${res.modifiedCount}건 (rt+reason+rtConf, rt_old 백업)`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
