/**
 * 짧은 법령명 맨언급 law 엣지 백필 — 조번호 없는 "민법상 위임계약"·"상법 그 밖의…" 꼴 소급.
 *
 * 추출기에 shortLaws 패턴을 넣었지만 기존 문서는 srcHash 재사용으로 재추출을 건너뛴다.
 * 법령 후보는 LLM 게이트를 안 타므로 재도출 없이 직접 삽입한다(빌드와 동일한 형태 + 보강값).
 * 조문 본문이 기존 엣지의 srcHash와 다르면(=마지막 도출 이후 변경) 삽입하지 않고 건너뛴다 —
 * 섞어 넣으면 무변경 재사용 판정이 스테일 엣지를 살릴 수 있다.
 *
 * 실행: npx tsx src/scripts/backfill-short-law-edges.ts [--write]  (기본 dry-run)
 */
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { extractCandidatesForDoc } from "@/lib/regulations-graph-build";
import { classifyRelTypeForTarget } from "@/lib/regulations-rel-classify";
import { articleHash } from "@/lib/article-hash";
import { collectionName } from "@/lib/collections";

async function main() {
  const write = process.argv.includes("--write");
  await connectDb();
  const db = mongoose.connection.db!;
  const ecol = db.collection(collectionName("ragGraphEdges"));

  const allLean = (await RagRegulationModel.find({}, { title: 1, category: 1 }).lean()) as { title?: string; category?: string }[];
  const allTitles = allLean.map((d) => String(d.title || ""));
  const internalKeys = new Set(allLean.filter((d) => !["법령", "행정규칙"].includes(String(d.category || ""))).map((d) => String(d.title || "").replace(/\s+/g, "")));
  const shortLawNames = new Set(allTitles.filter((t) => t.replace(/\s+/g, "").length < 4 && !internalKeys.has(t.replace(/\s+/g, ""))));

  const docs = (await RagRegulationModel.find({ category: { $nin: ["법령", "행정규칙"] } }, { title: 1, articles: 1 }).lean()) as
    { title: string; articles: { name: string; fullText?: string }[] }[];

  let ins = 0, dup = 0, stale = 0;
  for (const d of docs) {
    const arts = d.articles ?? [];
    const cands = extractCandidatesForDoc(arts, d.title, allTitles, { internalKeys })
      .filter((c) => c.type === "외부법령" && shortLawNames.has(String(c.tgt)));
    for (const c of cands) {
      if (await ecol.findOne({ kind: "law", sdoc: d.title, sname: c.sname, tgt: c.tgt })) { dup++; continue; }
      const a = arts[c.sci];
      const curHash = articleHash(a.name, (a.fullText || "").replace(/\s+/g, " ").trim());
      const anyEdge = (await ecol.findOne({ sdoc: d.title, sname: c.sname, kind: { $in: ["ref", "law"] }, srcHash: { $type: "string", $ne: "" } })) as { srcHash?: string } | null;
      if (anyEdge && anyEdge.srcHash !== curHash) { stale++; console.log(`  ⏭ 변경된 조문, 재적재 몫: ${d.title} · ${c.sname}`); continue; }
      const cls = classifyRelTypeForTarget(a.fullText || "", String(c.tgt));
      ins++;
      console.log(`  + ${d.title} · ${c.sname} → ${c.tgt} (rt=${cls.rt}/${cls.conf})`);
      if (write) await ecol.insertOne({
        kind: "law", sdoc: d.title, sci: c.sci, sname: c.sname, tt: "law", tgt: c.tgt,
        lawName: c.tgt, lawDoc: c.tgt, rt: cls.rt, rtConf: cls.conf, reason: String(c.snip || "").slice(0, 200), srcHash: curHash,
      });
    }
  }
  console.log(`\n삽입 ${ins} · 기존재 ${dup} · 변경조문 보류 ${stale} ${write ? "— 적용 완료" : "(dry-run — --write로 적용)"}`);
  await mongoose.disconnect();
}
void main();
