/** route의 심층/간편 '회수→재랭킹' 경로를 복제해 최종 refs만 빠르게 확인(LLM 답변생성 제외).
 *  MONGODB_URI=... OPENAI_*=... npx tsx src/scripts/diag-deep-refs.ts "질의" [fast|deep]
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { vectorSearchSeeds } from "@/lib/regulations-vector";
import { graphCoherence } from "@/lib/regulations-graph";
import { semanticTermsForRag, expandTermsForRag, queryTermsFromQuestion, termMatchRatio, compactPhraseMatch, ragRegulationTextBlob } from "@/lib/regulations-rag";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";

type Hit = { _id?: unknown; title?: string; year?: string; content?: string };
const keyOf = (h: Hit) => (h._id != null ? String(h._id) : `${h.title ?? ""}::${h.year ?? ""}`);
const blobOf = (h: Hit) => ragRegulationTextBlob({ title: h.title, year: h.year, content: h.content });

// route의 rerankHits 복제(벡터·coherence 신호 포함)
function rerank(q: string, textHits: Hit[], vec?: Map<string, number>, coh?: Map<string, number>): Hit[] {
  const semantic = semanticTermsForRag(q);
  const terms = semantic.length ? semantic : expandTermsForRag(q, queryTermsFromQuestion(q));
  const merged = new Map<string, { hit: Hit; score: number }>();
  textHits.forEach((h, i) => {
    const k = keyOf(h);
    const e = merged.get(k) ?? { hit: h, score: 0 };
    e.score += Math.max(0, 42 - i * 2.8);
    merged.set(k, e);
  });
  for (const e of merged.values()) {
    const blob = blobOf(e.hit);
    const tr = termMatchRatio(blob, terms);
    const cp = compactPhraseMatch(q, blob);
    e.score += tr * 28 + cp * 22;
    if (terms.length && tr === 0 && cp === 0) e.score *= 0.35;
    if (vec) e.score += (vec.get(e.hit.title ?? "") ?? 0) * 40;
    if (coh) e.score += Math.min(coh.get(e.hit.title ?? "") ?? 0, 3) * 6;
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).map((x) => x.hit);
}

async function main() {
  const q = process.argv[2] || "전문점 계약 체결시 계약자에게 안내해야할 사항";
  const deep = (process.argv[3] || "deep") === "deep";
  const maxDocs = deep ? 8 : 5;
  await connectDb();
  const cfg = await getPlaygroundConfig();
  console.log(`질의: ${q}  [${deep ? "deep" : "fast"}]`);

  // 심층 의도·키워드 확장
  let searchQuery = q;
  if (deep) {
    const { chatLlm } = await import("@/lib/llm");
    const INTENT = "다음 사내 사규 질문의 핵심 의도를 한 문장으로 요약하고, 검색에 쓸 핵심 키워드(동의어·관련 제도/법령명 포함)를 쉼표로 8개 이내 나열하세요. 다른 설명 없이 아래 형식 두 줄만 출력:\n의도: <한 문장>\n키워드: <쉼표로 구분>\n\n질문: " + q;
    const out = await chatLlm([{ role: "user", content: INTENT }], { maxTokens: 512, temperature: 0.1 });
    const kw = (out.match(/키워드\s*[:：]\s*(.+)/)?.[1] ?? "").split(/[,，、]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 24).slice(0, 8);
    if (kw.length) searchQuery = `${q} ${kw.join(" ")}`;
    console.log("확장키워드:", kw);
  }

  // 회수: 원질문 1차 + (심층) 확장질의 append
  const textHits = (await retrieveRagRegulationsForQa(q, maxDocs + (deep ? 6 : 4))) as Hit[];
  if (deep && searchQuery !== q) {
    const have = new Set(textHits.map(keyOf));
    const extra = (await retrieveRagRegulationsForQa(searchQuery, maxDocs)) as Hit[];
    for (const h of extra) { const k = keyOf(h); if (!have.has(k)) { textHits.push(h); have.add(k); } }
  }

  // 벡터(원질문) + coherence
  const vs = await vectorSearchSeeds(q, maxDocs * 4 + 8, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl });
  let maxV = 0; for (const v of vs) if (v.score > maxV) maxV = v.score;
  const vec = new Map(vs.map((v) => [v.title, maxV > 0 ? v.score / maxV : 0]));
  const coh = await graphCoherence(textHits.map((h) => h.title).filter((t): t is string => !!t));

  const ranked = rerank(q, textHits, vec, coh).slice(0, maxDocs);
  console.log(`\n[최종 refs top${maxDocs}]`);
  ranked.forEach((h, i) => {
    const t = h.title ?? "";
    const flag = t.includes("광고") ? "  ← 광고!" : (t.includes("전문점") ? "  ✓" : "");
    console.log(`  ${i + 1}. ${t}${flag}`);
  });
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
