/** law 엣지 정제 1단계 — 결정론 분류·정규화. 3버킷: named(명명·정규화) / generic("외부법령") / misclassified(내부규정 오분류).
 *  MONGODB_URI=... npx tsx src/scripts/law-triage.ts
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
const norm = (s: string) => String(s || "").replace(/[\s·ㆍ‧․.]/g, "").trim();
// 명백한 동의어 → 정규명
const SYN: Record<string, string> = {
  "국가를당사자로하는계약에관한법률": "국가계약법",
  "부정청탁및금품등수수의금지": "청탁금지법",
  "부정청탁및금품등수수의금지에관한법률": "청탁금지법",
  "부패방지권익위법": "부패방지 및 국민권익위원회의 설치와 운영에 관한 법률",
  "남녀고용평등": "남녀고용평등과 일·가정 양립 지원에 관한 법률",
};
function canon(lawName: string): string {
  const n = norm(lawName);
  return SYN[n] ?? lawName.replace(/\s+/g, " ").trim();
}

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
  const titles = (await RagRegulationModel.find({}).select({ title: 1 }).lean()).map((d) => String((d as { title?: string }).title));
  const normTitle = new Map(titles.map((t) => [norm(t), t]));

  const laws = (await db.collection(collectionName("ragGraphEdges")).find({ kind: "law" },
    { projection: { sdoc: 1, sci: 1, sname: 1, tgt: 1 } }).toArray()) as unknown as
    { _id: unknown; sdoc: string; sci: number; sname: string; tgt: string }[];

  const docs = (await RagRegulationModel.find({ title: { $in: [...new Set(laws.map((l) => l.sdoc))] } })
    .select({ title: 1, "articles.name": 1, "articles.fullText": 1 }).lean()) as unknown as
    { title?: string; articles?: { name?: string; fullText?: string }[] }[];
  const byTitle = new Map(docs.map((d) => [String(d.title), d]));

  const named: Record<string, unknown>[] = [], generic: Record<string, unknown>[] = [], misclassified: Record<string, unknown>[] = [];
  for (const l of laws) {
    const lawName = (l.tgt || "").replace(/\s*제\s*\d+\s*조.*$/, "").trim();
    const nn = norm(lawName);
    const rec = { _id: String(l._id), sdoc: l.sdoc, sname: l.sname, tgt: l.tgt };
    if (!lawName || lawName === "외부법령") {
      const src = findArticleText(byTitle.get(l.sdoc)?.articles, l.sname);
      generic.push({ ...rec, clause: src.slice(0, 320) });
    } else if (normTitle.has(nn)) {
      misclassified.push({ ...rec, internalTitle: normTitle.get(nn) });
    } else {
      named.push({ ...rec, law: canon(lawName) });
    }
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/law-named.json`, JSON.stringify(named, null, 1));
  fs.writeFileSync(`${DIR}/law-generic.json`, JSON.stringify(generic, null, 1));
  fs.writeFileSync(`${DIR}/law-misclassified.json`, JSON.stringify(misclassified, null, 1));

  const distinct = new Map<string, number>();
  named.forEach((r) => distinct.set(r.law as string, (distinct.get(r.law as string) ?? 0) + 1));
  console.log(`law ${laws.length} → named ${named.length} / generic ${generic.length} / 오분류 ${misclassified.length}`);
  console.log(`\n명명된 고유 법령 ${distinct.size}개:`);
  [...distinct.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}  ${k}`));
  console.log(`\n오분류(내부규정→law) ${misclassified.length}:`);
  console.log("  " + [...new Set(misclassified.map((m) => m.internalTitle as string))].join(", "));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
