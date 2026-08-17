/**
 * 미탐 참조 백필 — 짧은 제목(정관·민법 등)·모규정 관용 표현("동 규정/규정 제N조") 추출 확장의 소급.
 *
 * 새 추출 로직은 재적재 때만 도는데, 무변경 조문은 srcHash 재사용으로 재추출을 건너뛰므로
 * 기존 103건에는 영원히 반영되지 않는다. 새 후보가 생기는 문서만 골라 해시 박제를 걷어내고
 * updateGraphForDoc을 태워 표준 경로(LLM 참·거짓 게이트 + 규칙 rt) 그대로 재도출한다.
 *
 * 실행: npx tsx src/scripts/backfill-missed-refs.ts [--write]  (기본 dry-run)
 */
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { RagRegulationModel } from "@/models/RagRegulation";
import { extractCandidatesForDoc, updateGraphForDoc } from "@/lib/regulations-graph-build";
import { collectionName } from "@/lib/collections";

async function main() {
  const write = process.argv.includes("--write");
  await connectDb();
  const db = mongoose.connection.db!;
  const ecol = db.collection(collectionName("ragGraphEdges"));

  const docs = (await RagRegulationModel.find({ category: { $nin: ["법령", "행정규칙"] } }, { title: 1, articles: 1 }).lean()) as
    { title: string; articles: { name: string; fullText?: string }[] }[];
  const allLean = (await RagRegulationModel.find({}, { title: 1, category: 1 }).lean()) as { title?: string; category?: string }[];
  const allTitles = allLean.map((d) => String(d.title || ""));
  const internalKeys = new Set(allLean.filter((d) => !["법령", "행정규칙"].includes(String(d.category || ""))).map((d) => String(d.title || "").replace(/\s+/g, "")));

  const affected: { title: string; news: string[] }[] = [];
  for (const d of docs) {
    const hier = (await ecol.findOne({ kind: "hier", sdoc: d.title }, { projection: { tdoc: 1 } })) as { tdoc?: string } | null;
    const cands = extractCandidatesForDoc(d.articles ?? [], d.title, allTitles, { hierParent: hier?.tdoc ? String(hier.tdoc) : undefined, internalKeys });
    const edges = await ecol.find({ sdoc: d.title, kind: { $in: ["ref", "law"] } }, { projection: { sname: 1, tdoc: 1, tname: 1, tgt: 1, kind: 1 } }).toArray();
    const have = new Set(edges.map((e) => e.kind === "law" ? `L|${e.sname}|${e.tgt}` : `R|${e.sname}|${e.tdoc ?? ""}|${e.tname ?? ""}`));
    const news = cands
      .filter((c) => c.type === "외부규정" || c.type === "외부법령")
      .map((c) => c.type === "외부법령" ? `L|${c.sname}|${c.tgt}` : `R|${c.sname}|${c.tdoc ?? ""}|`)
      .filter((k) => k.startsWith("L") ? !have.has(k) : ![...have].some((h) => h.startsWith(k)));
    if (news.length) affected.push({ title: d.title, news: [...new Set(news)] });
  }

  console.log(`새 후보가 생기는 문서 ${affected.length}건:`);
  for (const a of affected) console.log(`  ${a.title}: +${a.news.length}  ${a.news.slice(0, 3).map((n) => n.split("|").slice(1).join("→")).join(" · ")}${a.news.length > 3 ? " …" : ""}`);

  if (!write) { console.log("\n(dry-run — --write로 재도출 실행)"); await mongoose.disconnect(); return; }

  for (const a of affected) {
    // 해시 박제 제거 → 전 조문 재추출·재검증(LLM 게이트·규칙 rt 표준 경로)
    await ecol.deleteOne({ kind: "arthash", sdoc: a.title });
    await ecol.updateMany({ sdoc: a.title, kind: { $in: ["ref", "law"] } }, { $unset: { srcHash: "" } });
    const r = await updateGraphForDoc(a.title);
    console.log(`  재도출 ${a.title}: ref ${r.refEdges} · law ${r.lawEdges} · llmFallback ${r.llmFallback}`);
  }
  await mongoose.disconnect();
}
void main();
