/** ref 전수 재타이핑 준비 — kind:ref(1,831) 엣지를 Opus 타이핑용 배치로(조문 원문 포함).
 *  tt:doc=대상 규정명으로, tt:chunk=조문번호로 절 국소화. MONGODB_URI=... npx tsx src/scripts/split-ref-edges.ts [batchSize]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { localizeClause } from "@/lib/regulations-rel-classify";
import { collectionName } from "@/lib/collections";

const REFDIR = path.join(process.env.GEDGE_DIR || path.join(process.cwd(), "data/tmp/gedge"), "ref");
const BATCH = parseInt(process.argv[2] || "40", 10);
const norm = (s: string) => String(s || "").replace(/\s+/g, "");

function findArticleText(arts: { name?: string; fullText?: string }[] | undefined, sname: string): string {
  if (!arts?.length) return "";
  const key = norm(sname);
  let a = arts.find((x) => norm(x.name ?? "") === key);
  if (!a) a = arts.find((x) => key && (norm(x.name ?? "").includes(key) || key.includes(norm(x.name ?? ""))));
  return (a?.fullText ?? "").trim();
}
function locKey(tt: string, tdoc: string, tname: string): string {
  if (tt === "chunk") {
    const m = (tname || "").match(/제\s*\d+\s*조(?:의\s*\d+)?|별표\s*제?\s*\d+\s*호|별지\s*제?\s*\d+\s*호|부칙/);
    return m ? m[0] : (tname || tdoc);
  }
  return tdoc;
}

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const edges = (await db.collection(collectionName("ragGraphEdges")).find({ kind: "ref" },
    { projection: { sdoc: 1, sname: 1, rt: 1, tt: 1, tdoc: 1, tname: 1 } }).toArray()) as unknown as
    { _id: unknown; sdoc: string; sname: string; rt: string; tt: string; tdoc: string; tname?: string }[];
  const docs = (await RagRegulationModel.find({ title: { $in: [...new Set(edges.map((e) => e.sdoc))] } })
    .select({ title: 1, "articles.name": 1, "articles.fullText": 1 }).lean()) as unknown as
    { title?: string; articles?: { name?: string; fullText?: string }[] }[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));

  const master = edges.map((e, idx) => {
    const art = findArticleText(byTitle.get(e.sdoc)?.articles, e.sname).slice(0, 460);
    const key = locKey(e.tt, e.tdoc, e.tname ?? "");
    const target = e.tt === "chunk" ? `(동일문서 조문) ${e.tname ?? key}` : `「${e.tdoc}」`;
    return { idx, _id: String(e._id), sdoc: e.sdoc, sname: e.sname, tt: e.tt, target, clause: localizeClause(art, key).clause.slice(0, 340) };
  });

  fs.rmSync(REFDIR, { recursive: true, force: true });
  fs.mkdirSync(REFDIR, { recursive: true });
  fs.writeFileSync(`${REFDIR}/master.json`, JSON.stringify(master));
  let n = 0;
  for (let i = 0; i < master.length; i += BATCH) {
    const batch = master.slice(i, i + BATCH).map((m) => ({ idx: m.idx, src: `「${m.sdoc}」 ${m.sname}`, target: m.target, tt: m.tt, clause: m.clause }));
    fs.writeFileSync(`${REFDIR}/b${n}.json`, JSON.stringify(batch, null, 1));
    n++;
  }
  const byTt = edges.reduce((a, e) => { a[e.tt] = (a[e.tt] ?? 0) + 1; return a; }, {} as Record<string, number>);
  console.log(`ref ${master.length}개(${JSON.stringify(byTt)}) → 배치 ${n}개(배치당 ${BATCH}). ${REFDIR}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
