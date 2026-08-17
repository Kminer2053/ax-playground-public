/** law 정제 2단계 — 내부규정이 law로 오분류된 엣지를 ref/tt:doc로 정정(kind_old 백업).
 *  MONGODB_URI=... npx tsx src/scripts/fix-misclassified-law.ts [--write]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";

const DIR = process.env.GEDGE_DIR || path.join(process.cwd(), "data/tmp/gedge");
const WRITE = process.argv.includes("--write");

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const mis = JSON.parse(fs.readFileSync(`${DIR}/law-misclassified.json`, "utf8")) as { _id: string; internalTitle: string }[];
  console.log(`오분류 ${mis.length}건 → ref/tt:doc 정정 대상`);
  if (!WRITE) { console.log("(리포트만 — 반영하려면 --write)"); await mongoose.disconnect(); return; }
  const { ObjectId } = await import("mongodb");
  const ops = mis.map((m) => ({
    updateOne: {
      filter: { _id: new ObjectId(m._id) },
      update: [{ $set: { kind_old: { $ifNull: ["$kind_old", "$kind"] } } },
               { $set: { kind: "ref", tt: "doc", tdoc: m.internalTitle, rt: "" } },
               { $unset: "tgt" }],
    },
  }));
  const res = await db.collection(collectionName("ragGraphEdges")).bulkWrite(ops as unknown as never[]);
  console.log(`정정 완료: ${res.modifiedCount}건 (law→ref/tt:doc, kind_old 백업, ref 타이핑 대상에 합류)`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
