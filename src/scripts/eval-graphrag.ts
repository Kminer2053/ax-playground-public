/**
 * GraphRAG A/B 평가 — 기존(키워드 $text) vs 개선(키워드+벡터+그래프) 정답문서 회수율 비교.
 *   MONGODB_URI=... OLLAMA_EMBEDDING_MODEL=bge-m3 EMBEDDING_DIMENSIONS=1024 npx tsx src/scripts/eval-graphrag.ts
 */
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

type Case = { q: string; cat: "직접" | "의미" | "참조"; expect: string[] };
const CASES: Case[] = [
  // 직접형 — 키워드가 규정 용어와 일치(기존도 잘 찾아야, 개선이 해치면 안 됨)
  { q: "연차휴가는 며칠인가요?", cat: "직접", expect: ["취업 규칙", "인사 규정"] },
  { q: "출장 여비 지급 기준", cat: "직접", expect: ["여비지급 세칙"] },
  { q: "징계의 종류는 무엇이 있나요?", cat: "직접", expect: ["상벌운영 세칙", "인사 규정"] },
  { q: "예산 편성 절차", cat: "직접", expect: ["예산 규정"] },
  { q: "물품 구매 계약 방법", cat: "직접", expect: ["계약업무 처리지침"] },
  { q: "안전보건 관리체계", cat: "직접", expect: ["안전보건관리 규정"] },
  { q: "정보보안 사고 대응", cat: "직접", expect: ["정보보안업무 지침", "보안업무지침"] },
  { q: "광고 영업 대행 수수료", cat: "직접", expect: ["광고영업 규정", "광고관리업무 세칙"] },
  // 의미형 — 질문 표현이 규정 용어와 다름(벡터가 메워야)
  { q: "갑질 당하면 어디에 신고하나요?", cat: "의미", expect: ["직장 내 괴롭힘 예방 지침"] },
  { q: "회사 기물을 파손했을 때 배상", cat: "의미", expect: ["직원변상에 관한 처리 지침"] },
  { q: "성적 수치심을 주는 행동 신고", cat: "의미", expect: ["성희롱·성폭력예방 및 2차 피해방지 지침"] },
  { q: "누가 계속 따라다니고 연락해요", cat: "의미", expect: ["스토킹 예방 지침"] },
  { q: "내부 비리를 제보하면 보호받나요?", cat: "의미", expect: ["공익신고 등의 처리 및 신고자 보호 지침"] },
  { q: "집에서 일하고 싶어요", cat: "의미", expect: ["유연근무제 운영지침"] },
  { q: "결혼하는데 회사 지원금 있나요?", cat: "의미", expect: ["복지후생 세칙"] },
  { q: "나이 많은 직원 임금 줄이는 제도", cat: "의미", expect: ["임금피크제 운영지침"] },
  { q: "법인카드로 밥 먹어도 되나요?", cat: "의미", expect: ["법인카드 관리 및 운영지침"] },
  { q: "이해관계 충돌 신고 의무", cat: "의미", expect: ["취업규칙(샘플)", "임직원 행동강령"] },
  // 참조형 — 답이 '참조된 다른 규정'에 있음(그래프가 끌어와야)
  { q: "계약심의회 위원 구성과 임기", cat: "참조", expect: ["직제 규정", "계약업무 처리지침"] },
  { q: "상품권 구매 대금 회계처리", cat: "참조", expect: ["회계 규정", "계약업무 처리지침"] },
];

async function improvedSet(q: string): Promise<{ all: string[]; vec: string[]; graph: string[]; base: string[] }> {
  const baseDocs = (await retrieveRagRegulationsForQa(q, 5)) as { title?: string; articles?: { name?: string; fullText?: string }[] }[];
  const base = baseDocs.map((d) => d.title ?? "").filter(Boolean);
  const have = new Set(base);
  const vs = (await vectorSearchSeeds(q, 3)).filter((v) => !have.has(v.title));
  const vec = vs.map((v) => v.title);
  vec.forEach((t) => have.add(t));
  const s = semanticTermsForRag(q);
  const terms = s.length ? s : expandTermsForRag(q, queryTermsFromQuestion(q));
  const exp = (await expandViaGraph([...baseDocs, ...vs.map((v) => v.doc)], terms, 2)).filter((e) => !have.has(e.title));
  const graph = exp.map((e) => e.title);
  return { base, vec, graph, all: [...base, ...vec, ...graph] };
}

const hit = (set: string[], expect: string[]) => expect.some((e) => set.includes(e));

async function main() {
  await connectDb();
  const rows: { cat: string; q: string; baseHit: boolean; impHit: boolean; via: string; adds: number }[] = [];
  for (const c of CASES) {
    const { base, vec, graph, all } = await improvedSet(c.q);
    const baseHit = hit(base, c.expect);
    const impHit = hit(all, c.expect);
    let via = "-";
    if (impHit) {
      const e = c.expect.find((x) => all.includes(x))!;
      via = base.includes(e) ? "키워드" : vec.includes(e) ? "벡터" : "그래프";
    }
    rows.push({ cat: c.cat, q: c.q, baseHit, impHit, via, adds: vec.length + graph.length });
    console.log(`[${c.cat}] ${baseHit ? "○" : "✗"}→${impHit ? "○" : "✗"} (${via}) ${c.q}`);
    if (!baseHit && impHit) console.log(`        ⤷ 기존 실패→개선 회수: vec[${vec.join(",")}] graph[${graph.join(",")}]`);
  }
  const by = (cat: string) => rows.filter((r) => r.cat === cat);
  const pct = (rs: typeof rows, k: "baseHit" | "impHit") => rs.length ? Math.round((rs.filter((r) => r[k]).length / rs.length) * 100) : 0;
  console.log("\n==== 요약 (정답문서 회수율) ====");
  for (const cat of ["직접", "의미", "참조"]) {
    const rs = by(cat);
    console.log(`  ${cat}(${rs.length}): 기존 ${pct(rs, "baseHit")}% → 개선 ${pct(rs, "impHit")}%`);
  }
  console.log(`  전체(${rows.length}): 기존 ${pct(rows, "baseHit")}% → 개선 ${pct(rows, "impHit")}%`);
  const newWin = rows.filter((r) => !r.baseHit && r.impHit);
  console.log(`  기존 실패→개선 회수: ${newWin.length}건 (채널: ${JSON.stringify(newWin.reduce((a: Record<string, number>, r) => ((a[r.via] = (a[r.via] || 0) + 1), a), {}))})`);
  console.log(`  개선 추가문서 평균: ${(rows.reduce((a, r) => a + r.adds, 0) / rows.length).toFixed(1)}개/질의`);
  const regress = rows.filter((r) => r.baseHit && !r.impHit);
  console.log(`  회귀(기존○→개선✗): ${regress.length}건`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
