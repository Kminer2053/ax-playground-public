/** law 정제 4단계 — Workflow 식별·타이핑 결과(/tmp/law_typed.json)를 DB에 반영.
 *  law/master.json(idx→_id) 매핑. rt+reason+lawName+rtConf 저장, 보류는 rt="미상". rt_old/tgt_old 백업.
 *  MONGODB_URI=... npx tsx src/scripts/write-law-typed.ts [--write]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { collectionName } from "@/lib/collections";

const DIR = path.join(process.env.GEDGE_DIR || path.join(process.cwd(), "data/tmp/gedge"), "law");
const WRITE = process.argv.includes("--write");

const NORM = (s: string) => String(s || "").replace(/[\s·ㆍ‧․.]/g, "").trim();
const CANON: Record<string, string> = {
  "국가를당사자로하는계약에관한법률": "국가계약법",
  "국가를당사자로하는계약에관한법률시행령": "국가계약법 시행령",
  "국가를당사자로하는계약에관한법률시행규칙": "국가계약법 시행규칙",
  "개인정보보호법": "개인정보보호법",
  "공공기관의운영에관한법률": "공공기관의 운영에 관한 법률",
  "부정청탁및금품등수수의금지에관한법률": "청탁금지법",
  "부정청탁및금품등수수의금지": "청탁금지법",
};
const canon = (l: string) => CANON[NORM(l)] ?? String(l || "").replace(/\s+/g, " ").trim();

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const master = JSON.parse(fs.readFileSync(`${DIR}/master.json`, "utf8")) as { idx: number; _id: string }[];
  const id2 = new Map(master.map((m) => [m.idx, m._id]));
  const typed = JSON.parse(fs.readFileSync("/tmp/law_typed.json", "utf8")) as { idx: number; law: string; rt: string; rationale: string; conf: string }[];

  const stat = { resolved: 0, 보류: 0, missing: 0 };
  const { ObjectId } = await import("mongodb");
  const ops: Record<string, unknown>[] = [];
  for (const t of typed) {
    const id = id2.get(t.idx);
    if (!id) { stat.missing++; continue; }
    const hold = t.law === "보류" || !t.law;
    if (hold) stat.보류++; else stat.resolved++;
    ops.push({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: [
          { $set: { rt_old: { $ifNull: ["$rt_old", { $ifNull: ["$rt", null] }] }, tgt_old: { $ifNull: ["$tgt_old", "$tgt"] } } },
          { $set: { rt: hold ? "미상" : t.rt, reason: t.rationale ?? "", lawName: hold ? "" : canon(t.law), rtConf: t.conf ?? "하" } },
        ],
      },
    });
  }
  console.log(`타이핑 결과 ${typed.length}건 → 식별 ${stat.resolved} / 보류 ${stat.보류} / id매칭실패 ${stat.missing}`);
  if (!WRITE) { console.log("(리포트만 — --write로 반영)"); await mongoose.disconnect(); return; }
  const res = await db.collection(collectionName("ragGraphEdges")).bulkWrite(ops as unknown as never[]);
  console.log(`DB 반영: ${res.modifiedCount}건 (rt+reason+lawName+rtConf, rt_old/tgt_old 백업)`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
