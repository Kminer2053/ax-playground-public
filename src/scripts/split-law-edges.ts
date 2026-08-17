/** law 정제 3단계 — 852 law 엣지를 Opus 식별·타이핑용 배치로(조문 원문 포함).
 *  named: lawGiven(정규화 법령명) 제공. generic: lawGiven="" → 조문에서 식별. 둘 다 조문 텍스트 동봉.
 *  MONGODB_URI=... npx tsx src/scripts/split-law-edges.ts [batchSize]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { collectionName } from "@/lib/collections";

const DIR = process.env.GEDGE_DIR || path.join(process.cwd(), "data/tmp/gedge");
const LAWDIR = `${DIR}/law`;
const BATCH = parseInt(process.argv[2] || "35", 10);
const norm = (s: string) => String(s || "").replace(/[\s·ㆍ‧․.]/g, "").trim();
const SYN: Record<string, string> = {
  "국가를당사자로하는계약에관한법률": "국가계약법", "부정청탁및금품등수수의금지": "청탁금지법",
  "부정청탁및금품등수수의금지에관한법률": "청탁금지법",
};
const canon = (l: string) => SYN[norm(l)] ?? l.replace(/\s+/g, " ").trim();
function findArticleText(arts: { name?: string; fullText?: string }[] | undefined, sname: string): string {
  if (!arts?.length) return "";
  const key = norm(sname);
  let a = arts.find((x) => norm(x.name ?? "") === key);
  if (!a) a = arts.find((x) => key && (norm(x.name ?? "").includes(key) || key.includes(norm(x.name ?? ""))));
  return (a?.fullText ?? "").trim();
}

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const laws = (await db.collection(collectionName("ragGraphEdges")).find({ kind: "law" },
    { projection: { sdoc: 1, sname: 1, tgt: 1 } }).toArray()) as unknown as
    { _id: unknown; sdoc: string; sname: string; tgt: string }[];
  const docs = (await RagRegulationModel.find({ title: { $in: [...new Set(laws.map((l) => l.sdoc))] } })
    .select({ title: 1, "articles.name": 1, "articles.fullText": 1 }).lean()) as unknown as
    { title?: string; articles?: { name?: string; fullText?: string }[] }[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));

  const all = laws.map((l, idx) => {
    const lawName = (l.tgt || "").replace(/\s*제\s*\d+\s*조.*$/, "").trim();
    const lawGiven = (!lawName || lawName === "외부법령") ? "" : canon(lawName);
    const art = findArticleText(byTitle.get(l.sdoc)?.articles, l.sname).slice(0, 480);
    return { idx, _id: String(l._id), sdoc: l.sdoc, sname: l.sname, lawGiven, tgt: l.tgt, clause: art };
  });

  fs.rmSync(LAWDIR, { recursive: true, force: true });
  fs.mkdirSync(LAWDIR, { recursive: true });
  fs.writeFileSync(`${LAWDIR}/master.json`, JSON.stringify(all));
  let n = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH).map((m) => ({ idx: m.idx, src: `「${m.sdoc}」 ${m.sname}`, lawGiven: m.lawGiven, tgt: m.tgt, clause: m.clause }));
    fs.writeFileSync(`${LAWDIR}/b${n}.json`, JSON.stringify(batch, null, 1));
    n++;
  }
  const ng = all.filter((a) => !a.lawGiven).length;
  console.log(`law ${all.length}개(named ${all.length - ng}/generic ${ng}) → 배치 ${n}개(배치당 ${BATCH}). ${LAWDIR}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
