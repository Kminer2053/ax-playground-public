/** Opus 전수 재타이핑 준비 — ref+law 전체(2,683) 엣지를 절-컨텍스트와 함께 배치 파일로 분할.
 *  서브에이전트가 각 배치를 Read해 타이핑(컨텍스트 부담 0). master.json은 _id 매핑(쓰기용). hier 제외.
 *  MONGODB_URI=... npx tsx src/scripts/split-edges.ts [batchSize]
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

const DIR = process.env.GEDGE_DIR || path.join(process.cwd(), "data/tmp/gedge");
const BATCH = parseInt(process.argv[2] || "40", 10);

function findArticleText(arts: { name?: string; fullText?: string }[] | undefined, sname: string): string {
  if (!arts?.length) return "";
  const norm = (s: string) => String(s || "").replace(/\s+/g, "");
  const key = norm(sname);
  let a = arts.find((x) => norm(x.name ?? "") === key);
  if (!a) a = arts.find((x) => key && (norm(x.name ?? "").includes(key) || key.includes(norm(x.name ?? ""))));
  return (a?.fullText ?? "").trim();
}
/** 문서내 조문 대상은 조문번호로, 그 외는 대상명으로 절 국소화 키 결정 */
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
  const edges = (await db.collection(collectionName("ragGraphEdges")).find(
    { kind: { $in: ["ref", "law"] } },
    { projection: { kind: 1, sdoc: 1, sname: 1, rt: 1, tt: 1, tdoc: 1, tname: 1 } },
  ).toArray()) as unknown as { _id: unknown; kind: string; sdoc: string; sname: string; rt: string; tt: string; tdoc: string; tname?: string }[];

  const docs = (await RagRegulationModel.find({ title: { $in: [...new Set(edges.map((e) => e.sdoc))] } })
    .select({ title: 1, "articles.name": 1, "articles.fullText": 1, content: 1 }).lean()) as unknown as
    { title?: string; articles?: { name?: string; fullText?: string }[]; content?: string }[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));

  const master = edges.map((e, idx) => {
    const d = byTitle.get(e.sdoc);
    let src = findArticleText(d?.articles, e.sname);
    if (!src) { const c = d?.content ?? ""; const i = c.indexOf((e.sname || "").slice(0, 8)); src = i >= 0 ? c.slice(i, i + 600) : ""; }
    const key = locKey(e.tt, e.tdoc, e.tname ?? "");
    const target = e.kind === "law" ? `외부법령 「${e.tdoc}」` : (e.tt === "chunk" ? `(동일문서) ${e.tname ?? e.tdoc}` : `「${e.tdoc}」`);
    return { idx, _id: String(e._id), kind: e.kind, sdoc: e.sdoc, sname: e.sname, target, rt_gemma: e.rt ?? "", clause: localizeClause(src, key).clause.slice(0, 320) };
  });

  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/master.json`, JSON.stringify(master));
  let n = 0;
  for (let i = 0; i < master.length; i += BATCH) {
    const batch = master.slice(i, i + BATCH).map((m) => ({ idx: m.idx, kind: m.kind, src: `「${m.sdoc}」 ${m.sname}`, target: m.target, clause: m.clause }));
    fs.writeFileSync(`${DIR}/b${n}.json`, JSON.stringify(batch, null, 1));
    n++;
  }
  const byKind = edges.reduce((a, e) => { a[e.kind] = (a[e.kind] ?? 0) + 1; return a; }, {} as Record<string, number>);
  console.log(`엣지 ${master.length}개(${JSON.stringify(byKind)}) → 배치 ${n}개(배치당 ${BATCH}). ${DIR}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
