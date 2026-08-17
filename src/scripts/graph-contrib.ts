/** 그래프 기여도 측정 — 표본 질문에서 그래프 확장이 (a)정답을 단독 회수하는지 (b)distractor를 끼우는지.
 *   MONGODB_URI=mongodb://127.0.0.1:27017/axplayground npx tsx src/scripts/graph-contrib.ts */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { expandViaGraph } from "@/lib/regulations-graph";
import { vectorSearchSeeds } from "@/lib/regulations-vector";
import { semanticTermsForRag, expandTermsForRag, queryTermsFromQuestion } from "@/lib/regulations-rag";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";

type Q = { q: string; expect: string[]; cat: string };

async function main() {
  await connectDb();
  const cfg = await getPlaygroundConfig();
  const FULL = process.argv.includes("--full");
  const src = FULL ? "data/benchmark/queries.json" : "data/benchmark/results/quick-sample.json";
  const qs: Q[] = JSON.parse(fs.readFileSync(src, "utf8"));
  console.log(`그래프 기여도 — ${qs.length}문항 (${src})\n`);
  let graphCritical = 0, graphAdded = 0, graphDistract = 0, graphHelpful = 0;
  const byCat: Record<string, { n: number; crit: number; help: number; add: number; dist: number }> = {};
  for (const c of qs) {
    byCat[c.cat] ??= { n: 0, crit: 0, help: 0, add: 0, dist: 0 };
    byCat[c.cat].n++;
    const hits = (await retrieveRagRegulationsForQa(c.q, 8)) as { title?: string }[];
    const have = new Set(hits.map((h) => h.title));
    const vs = (await vectorSearchSeeds(c.q, 4, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl })).filter((v) => !have.has(v.title));
    vs.forEach((v) => have.add(v.title));
    const s = semanticTermsForRag(c.q);
    const terms = s.length ? s : expandTermsForRag(c.q, queryTermsFromQuestion(c.q));
    const baseSet = new Set<string>([...hits.map((h) => String(h.title)), ...vs.map((v) => v.title)]);
    const exp = (await expandViaGraph([...hits, ...vs.map((v) => v.doc)] as never, terms, 3)).filter((e) => !baseSet.has(e.title));
    const gTitles = exp.map((e) => e.title);
    graphAdded += gTitles.length;
    const inBase = c.expect.filter((e) => baseSet.has(e));
    const onlyGraph = c.expect.filter((e) => gTitles.includes(e) && !baseSet.has(e));
    const distract = gTitles.filter((t) => !c.expect.includes(t));
    if (onlyGraph.length) { graphCritical++; byCat[c.cat].crit++; }
    if (gTitles.some((t) => c.expect.includes(t))) { graphHelpful++; byCat[c.cat].help++; }
    graphDistract += distract.length;
    byCat[c.cat].add += gTitles.length;
    byCat[c.cat].dist += distract.length;
    if (!FULL || onlyGraph.length) {
      console.log(`[${c.cat}] ${c.q.slice(0, 32)} | base ${baseSet.size}(정답 ${inBase.length}/${c.expect.length}) graph+${gTitles.length} 단독회수 ${onlyGraph.length} distractor ${distract.length}`);
    }
  }
  console.log("\n==== 그래프 기여 요약 (" + qs.length + "문항) ====");
  console.log("유형  | n | 그래프단독회수 | 그래프정답추가 | 추가문서 | distractor");
  for (const [cat, s] of Object.entries(byCat)) {
    console.log(`${cat.padEnd(4)} | ${String(s.n).padStart(2)} | ${String(s.crit).padStart(13)} | ${String(s.help).padStart(13)} | ${String(s.add).padStart(7)} | ${s.dist}`);
  }
  console.log(`\n전체: 그래프 전용회수 ${graphCritical}/${qs.length} · 그래프 정답추가 ${graphHelpful}/${qs.length} · 추가문서 ${graphAdded}개 중 distractor ${graphDistract}개`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
