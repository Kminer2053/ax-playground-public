/** Phase1a — 관계 재분류 대조용 표본. 런타임 확장이 쓰는 tt:"doc" 교차규정 ref 엣지를 rt별로 추출 +
 *  출처 조문 원문 동봉. Opus가 새 스키마로 재분류→gemma 현행과 대조(노하우).
 *  MONGODB_URI=mongodb://127.0.0.1:27017/axplayground npx tsx src/scripts/extract-edge-samples.ts [perType]
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

const PER = parseInt(process.argv[2] || "5", 10);

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
  const titles = new Set<string>(
    (await RagRegulationModel.find({}).select({ title: 1 }).lean()).map((d) => String((d as { title?: string }).title)),
  );
  // 런타임 확장이 사용하는 교차규정 엣지: kind=ref, tt=doc, 대상이 내부 규정
  const edges = (await db.collection(collectionName("ragGraphEdges"))
    .find({ kind: "ref", tt: "doc" }, { projection: { _id: 0, sdoc: 1, sci: 1, sname: 1, rt: 1, tdoc: 1, reason: 1 } })
    .toArray()) as unknown as { sdoc: string; sci: number; sname: string; rt: string; tdoc: string; reason?: string }[];
  const internal = edges.filter((e) => titles.has(e.tdoc) && e.sdoc !== e.tdoc);
  // rt별 균등 표본
  const byRt = new Map<string, typeof internal>();
  for (const e of internal) { const a = byRt.get(e.rt) ?? []; if (a.length < PER) a.push(e); byRt.set(e.rt, a); }
  const sample = [...byRt.values()].flat();

  // 출처 조문 원문 동봉
  const srcTitles = [...new Set(sample.map((e) => e.sdoc))];
  const docs = (await RagRegulationModel.find({ title: { $in: srcTitles } })
    .select({ title: 1, "articles.name": 1, "articles.fullText": 1, content: 1 }).lean()) as {
      title?: string; articles?: { name?: string; fullText?: string }[]; content?: string }[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));

  const out = sample.map((e) => {
    const d = byTitle.get(e.sdoc);
    let src = findArticleText(d?.articles, e.sname);
    if (!src) { const c = d?.content ?? ""; const i = c.indexOf(e.sname.slice(0, 8)); src = i >= 0 ? c.slice(i, i + 600) : c.slice(0, 400); }
    return { sdoc: e.sdoc, sname: e.sname, rt_gemma: e.rt, tdoc: e.tdoc, src_text: src.slice(0, 700) };
  });
  fs.writeFileSync("/tmp/edge_samples.json", JSON.stringify(out, null, 1));
  console.log(`교차규정 ref 엣지: 전체 ${internal.length}개 → rt별 ${PER} 표본 ${out.length}개`);
  console.log("rt 분포(전체 교차규정):");
  const cnt = new Map<string, number>();
  for (const e of internal) cnt.set(e.rt, (cnt.get(e.rt) ?? 0) + 1);
  [...cnt.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log("저장: /tmp/edge_samples.json");
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
