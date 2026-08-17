import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";
import { expandViaGraph } from "@/lib/regulations-graph";
import { vectorSearchSeeds } from "@/lib/regulations-vector";
import { semanticTermsForRag, expandTermsForRag, queryTermsFromQuestion } from "@/lib/regulations-rag";

async function main() {
  await connectDb();
  const qs = [
    "계약심의회 위원 구성은 어떻게 되나요?",
    "상품권은 어떻게 구매하나요?",
    "갑질 당하면 어디에 신고하나요?", // 갑질 vs 괴롭힘 — 의미 갭
    "회사 기물 파손 배상", // 배상 vs 변상
    "출장 갔을 때 받는 돈", // 출장돈 vs 여비
  ];
  for (const q of qs) {
    const hits = (await retrieveRagRegulationsForQa(q, 8)) as { title?: string; articles?: { name?: string; fullText?: string }[] }[];
    const seed = hits.map((h) => h.title ?? "").filter(Boolean);
    const s = semanticTermsForRag(q);
    const terms = s.length ? s : expandTermsForRag(q, queryTermsFromQuestion(q));
    const have = new Set(seed);
    const vs = (await vectorSearchSeeds(q, 4)).filter((v) => !have.has(v.title));
    const exp = await expandViaGraph([...hits, ...vs.map((v) => v.doc)], terms, 3);
    console.log("\n■ Q:", q);
    console.log("  시드(키워드):", seed.slice(0, 6).join(" | ") || "(없음)");
    console.log(
      "  벡터 시드(키워드엔 없음):",
      vs.length ? vs.map((v) => `${v.title} (${v.score.toFixed(3)}, ←${v.bestChunk})`).join("\n                        ") : "(없음)",
    );
    console.log(
      "  그래프 확장:",
      exp.length ? exp.map((e) => `${e.title} ←「${e.from}」${e.fromChunk}(${e.rel})`).join("\n              ") : "(없음)",
    );
  }
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
