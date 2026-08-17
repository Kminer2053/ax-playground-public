/**
 * 문서명 부분 문자열 오탐 엣지 정리 — 일회성 백필.
 *
 * extractCandidatesForDoc이 "급여규정"⊂"급여규정시행세칙" 같은 포함 매칭으로 가짜 외부규정
 * 엣지를 만들었다(실측 17건). 최장 일치 우선으로 고친 추출기를 전 문서에 다시 돌려,
 * 지금은 나오지 않는 (sdoc,sname,tdoc) 조합의 ref(tt:doc) 엣지만 지운다.
 * LLM 판정을 다시 하는 게 아니라 추출 단계 오탐만 걷어내므로 안전하다.
 *
 * 실행: npx tsx src/scripts/fix-partial-doc-edges.ts [--write]  (기본 dry-run)
 */
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { extractCandidatesForDoc } from "@/lib/regulations-graph-build";
import { collectionName } from "@/lib/collections";

async function main() {
  const write = process.argv.includes("--write");
  await connectDb();
  const db = mongoose.connection.db!;
  const ecol = db.collection(collectionName("ragGraphEdges"));

  const allDocs = (await RagRegulationModel.find({}, { title: 1, category: 1, articles: 1 }).lean()) as
    { title: string; category?: string; articles: { name: string; fullText?: string }[] }[];
  const allTitles = allDocs.map((d) => d.title);
  const internalKeys = new Set(allDocs.filter((d) => !["법령", "행정규칙"].includes(String(d.category || ""))).map((d) => d.title.replace(/\s+/g, "")));

  const sdocs: string[] = await ecol.distinct("sdoc", { kind: "ref", tt: "doc" });
  let checked = 0, removed = 0;
  for (const sdoc of sdocs) {
    const doc = allDocs.find((d) => d.title === sdoc);
    if (!doc) continue;
    const hier = (await ecol.findOne({ kind: "hier", sdoc }, { projection: { tdoc: 1 } })) as { tdoc?: string } | null;
    const valid = new Set(
      extractCandidatesForDoc(doc.articles ?? [], sdoc, allTitles, { hierParent: hier?.tdoc ? String(hier.tdoc) : undefined, internalKeys })
        .filter((c) => c.type === "외부규정")
        .map((c) => `${c.sname}→${c.tdoc}`),
    );
    const edges = await ecol.find({ kind: "ref", tt: "doc", sdoc }).toArray();
    for (const e of edges) {
      checked++;
      const key = `${e.sname}→${e.tdoc}`;
      if (valid.has(key)) continue;
      console.log(`  ✗ [${sdoc}] ${e.sname} → ${e.tdoc}  (재도출 불가 — 오탐)`);
      removed++;
      if (write) await ecol.deleteOne({ _id: e._id });
    }
  }
  console.log(`\n검사 ${checked}건 · 오탐 ${removed}건 ${write ? "삭제 완료" : "(dry-run — --write로 삭제)"}`);
  await mongoose.disconnect();
}
void main();
