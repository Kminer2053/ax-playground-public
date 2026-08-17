/** Phase1b — 규칙 분류기를 교차규정 엣지 전수에 적용, gemma 현행과 대조(전이행렬·신규유형·저신뢰).
 *  MONGODB_URI=mongodb://127.0.0.1:27017/axplayground npx tsx src/scripts/reclassify-edges.ts [--write]
 *  --write: 교정 rt를 rag_graph_edges에 반영(rt_old 백업). 없으면 리포트만.
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { classifyRelTypeForTarget } from "@/lib/regulations-rel-classify";
import { collectionName } from "@/lib/collections";

const WRITE = process.argv.includes("--write");

function findArticleText(arts: { name?: string; fullText?: string }[] | undefined, sname: string): string {
  if (!arts?.length) return "";
  const norm = (s: string) => String(s || "").replace(/\s+/g, "");
  const key = norm(sname);
  let a = arts.find((x) => norm(x.name ?? "") === key);
  if (!a) a = arts.find((x) => key && (norm(x.name ?? "").includes(key) || key.includes(norm(x.name ?? ""))));
  return (a?.fullText ?? "").trim();
}

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const titles = new Set<string>((await RagRegulationModel.find({}).select({ title: 1 }).lean()).map((d) => String((d as { title?: string }).title)));
  const edges = (await db.collection(collectionName("ragGraphEdges"))
    .find({ kind: "ref", tt: "doc" }, { projection: { sdoc: 1, sci: 1, sname: 1, rt: 1, tdoc: 1 } })
    .toArray()) as { _id: unknown; sdoc: string; sci: number; sname: string; rt: string; tdoc: string }[];
  const internal = edges.filter((e) => titles.has(e.tdoc) && e.sdoc !== e.tdoc);

  const srcTitles = [...new Set(internal.map((e) => e.sdoc))];
  const docs = (await RagRegulationModel.find({ title: { $in: srcTitles } })
    .select({ title: 1, "articles.name": 1, "articles.fullText": 1, content: 1 }).lean()) as {
      title?: string; articles?: { name?: string; fullText?: string }[]; content?: string }[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));

  const trans = new Map<string, number>(); // "gemma→rule"
  const newType = new Map<string, number>();
  const confCnt = new Map<string, number>();
  let changed = 0, noSrc = 0;
  const changeSamples: string[] = [];
  const updates: { id: unknown; rt: string; conf: string }[] = [];

  for (const e of internal) {
    const d = byTitle.get(e.sdoc);
    let src = findArticleText(d?.articles, e.sname);
    if (!src) { const c = d?.content ?? ""; const i = c.indexOf(e.sname.slice(0, 8)); src = i >= 0 ? c.slice(i, i + 600) : ""; }
    if (!src) noSrc++;
    const { rt, conf } = classifyRelTypeForTarget(src, e.tdoc);
    confCnt.set(conf, (confCnt.get(conf) ?? 0) + 1);
    if (rt !== e.rt) {
      changed++;
      const k = `${e.rt} → ${rt}`;
      trans.set(k, (trans.get(k) ?? 0) + 1);
      if (rt === "상충·우선" || rt === "제재·벌칙") newType.set(rt, (newType.get(rt) ?? 0) + 1);
      if (changeSamples.length < 14) changeSamples.push(`  [${e.rt}→${rt}/${conf}] 「${e.sdoc}」 ${e.sname} → 「${e.tdoc}」`);
    }
    updates.push({ id: e._id, rt, conf });
  }

  console.log(`교차규정 엣지 ${internal.length}개 (출처본문 없음 ${noSrc})`);
  console.log(`규칙 분류 변경: ${changed}/${internal.length} (${Math.round(changed / internal.length * 100)}%)`);
  console.log("\n전이(gemma → 규칙), 상위:");
  [...trans.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log("\n신규유형 발굴:", [...newType.entries()].map(([k, v]) => `${k} ${v}`).join(" · ") || "(없음)");
  console.log("신뢰도 분포:", [...confCnt.entries()].map(([k, v]) => `${k} ${v}`).join(" · "));
  console.log("\n변경 표본:");
  changeSamples.forEach((s) => console.log(s));

  if (WRITE) {
    const ops = updates.map((u) => ({ updateOne: { filter: { _id: u.id }, update: [{ $set: { rt_old: { $ifNull: ["$rt_old", "$rt"] } } }, { $set: { rt: u.rt, rtConf: u.conf } }] } }));
    // rt_old는 $ifNull로 최초 1회만 백업 — 재실행이 원본 라벨 백업을 파괴하지 않게(주석과 동작이 어긋나 있었다)
    const res = await db.collection(collectionName("ragGraphEdges")).bulkWrite(ops as unknown as never[]);
    console.log(`\n[--write] rag_graph_edges 교정 반영: ${res.modifiedCount}건 (rt_old 백업)`);
  } else {
    console.log("\n(리포트만. 반영하려면 --write)");
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
