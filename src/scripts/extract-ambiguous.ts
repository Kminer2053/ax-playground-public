/** Phase2-B — 규칙이 저신뢰(conf 중·하)로 남긴 교차규정 엣지를 절-컨텍스트와 함께 추출.
 *  Opus가 이를 재타이핑(rt+rationale) → few-shot 예시은행·§8.3. gemma rt별 균등 표본.
 *  MONGODB_URI=... npx tsx src/scripts/extract-ambiguous.ts [perRt]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { classifyRelTypeForTarget, localizeClause } from "@/lib/regulations-rel-classify";
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
  const titles = new Set<string>((await RagRegulationModel.find({}).select({ title: 1 }).lean()).map((d) => String((d as { title?: string }).title)));
  const edges = (await db.collection(collectionName("ragGraphEdges"))
    .find({ kind: "ref", tt: "doc" }, { projection: { sdoc: 1, sci: 1, sname: 1, rt: 1, tdoc: 1 } })
    .toArray()) as unknown as { sdoc: string; sci: number; sname: string; rt: string; tdoc: string }[];
  const internal = edges.filter((e) => titles.has(e.tdoc) && e.sdoc !== e.tdoc);
  const srcTitles = [...new Set(internal.map((e) => e.sdoc))];
  const docs = (await RagRegulationModel.find({ title: { $in: srcTitles } })
    .select({ title: 1, "articles.name": 1, "articles.fullText": 1, content: 1 }).lean()) as unknown as {
      title?: string; articles?: { name?: string; fullText?: string }[]; content?: string }[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));

  const byRt = new Map<string, Record<string, string>[]>();
  for (const e of internal) {
    const d = byTitle.get(e.sdoc);
    let src = findArticleText(d?.articles, e.sname);
    if (!src) { const c = d?.content ?? ""; const i = c.indexOf(e.sname.slice(0, 8)); src = i >= 0 ? c.slice(i, i + 600) : ""; }
    if (!src) continue;
    const cls = classifyRelTypeForTarget(src, e.tdoc);
    if (cls.conf === "상") continue; // 규칙 고신뢰는 제외 — 모호분만
    const clause = localizeClause(src, e.tdoc).clause.slice(0, 320);
    const arr = byRt.get(e.rt) ?? [];
    if (arr.length < PER) arr.push({ sdoc: e.sdoc, sname: e.sname, tdoc: e.tdoc, rt_gemma: e.rt, rt_rule: cls.rt, conf: cls.conf, clause });
    byRt.set(e.rt, arr);
  }
  const out = [...byRt.values()].flat();
  fs.writeFileSync("/tmp/ambiguous_edges.json", JSON.stringify(out, null, 1));
  console.log(`모호 엣지 표본 ${out.length}개 (gemma rt별 최대 ${PER})`);
  console.log("저장: /tmp/ambiguous_edges.json");
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
