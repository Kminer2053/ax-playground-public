/** 검색 관련성 진단 — 한 질의에 대해 키워드/의미/그래프 채널이 각각 무엇을 회수하는지.
 *  MONGODB_URI=... OPENAI_COMPATIBLE_BASE_URL=... npx tsx src/scripts/diag-retrieve.ts "질의"
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { vectorSearchSeeds } from "@/lib/regulations-vector";
import { expandViaGraph } from "@/lib/regulations-graph";
import { semanticTermsForRag, expandTermsForRag, queryTermsFromQuestion } from "@/lib/regulations-rag";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";

async function main() {
  const q = process.argv[2] || "전문점 운영계약 체결시 계약자에게 안내해야할 사항";
  await connectDb();
  const cfg = await getPlaygroundConfig();
  console.log("질의:", q);
  console.log("의미토큰:", semanticTermsForRag(q));
  console.log("질의토큰:", queryTermsFromQuestion(q));

  const kw = (await retrieveRagRegulationsForQa(q, 10)) as { title?: string }[];
  console.log("\n[키워드 회수 top10 (원질의)]");
  kw.forEach((d, i) => console.log(`  ${i + 1}. ${d.title}`));

  // 심층 경로: gemma 의도·키워드 확장 후 재검색
  const { chatLlm } = await import("@/lib/llm");
  const INTENT = "다음 사내 사규 질문의 핵심 의도를 한 문장으로 요약하고, 검색에 쓸 핵심 키워드(동의어·관련 제도/법령명 포함)를 쉼표로 8개 이내 나열하세요. 다른 설명 없이 아래 형식 두 줄만 출력:\n의도: <한 문장>\n키워드: <쉼표로 구분>\n\n질문: " + q;
  const out = await chatLlm([{ role: "user", content: INTENT }], { maxTokens: 512, temperature: 0.1 });
  const kwLine = (out.match(/키워드\s*[:：]\s*(.+)/)?.[1] ?? "");
  const keywords = kwLine.split(/[,，、]/).map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, 8);
  console.log("\n[심층 gemma 확장 키워드]:", keywords);
  const searchQuery = keywords.length ? `${q} ${keywords.join(" ")}` : q;
  const kwExp = (await retrieveRagRegulationsForQa(searchQuery, 10)) as { title?: string }[];
  console.log("[확장질의 키워드 회수 top10 (심층 실제)]");
  kwExp.forEach((d, i) => console.log(`  ${i + 1}. ${d.title}`));

  const vs = await vectorSearchSeeds(q, 8, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
  console.log("\n[의미(벡터) 회수 top8 (점수)]");
  vs.forEach((v, i) => console.log(`  ${i + 1}. ${v.score.toFixed(3)} ${v.title}  (청크: ${v.bestChunk})`));

  const s = semanticTermsForRag(q);
  const terms = s.length ? s : expandTermsForRag(q, queryTermsFromQuestion(q));
  const seed = [...kw, ...vs.map((v) => v.doc)] as never;
  const exp = await expandViaGraph(seed, terms, 5);
  console.log("\n[그래프 확장 top5]");
  exp.forEach((e, i) => console.log(`  ${i + 1}. ${e.title}  ← 「${e.from}」 ${e.fromChunk} (${e.rel})`));

  console.log("\n[전문점 관련 문서가 키워드/의미에 있나?]");
  const all = [...kw.map((d) => d.title), ...vs.map((v) => v.title)];
  console.log("  전문점 포함:", all.filter((t) => t && t.includes("전문점")));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
