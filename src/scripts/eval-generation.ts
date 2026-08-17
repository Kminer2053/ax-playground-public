/**
 * 생성품질 A/B 평가 — 동일 컨텍스트에서 프롬프트 변형 A(이전: 전부 나열) vs B(현재: 직접답·[참고]강등) 비교.
 * 지표: 정답규정 인용율(정확성) · 답변길이 · 인용 규정 수(초점). 단발 질문이 아니라 질문셋 전체 집계.
 *   MONGODB_URI=... OLLAMA_EMBEDDING_MODEL=bge-m3 EMBEDDING_DIMENSIONS=1024 \
 *   OPENAI_COMPATIBLE_BASE_URL=... OPENAI_COMPATIBLE_MODEL=... npx tsx src/scripts/eval-generation.ts
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { retrieveRagRegulationsForQa, buildRegulationSnippetForLlm } from "@/lib/regulations-retrieve";
import { expandViaGraph } from "@/lib/regulations-graph";
import { vectorSearchSeeds } from "@/lib/regulations-vector";
import { semanticTermsForRag, expandTermsForRag, queryTermsFromQuestion } from "@/lib/regulations-rag";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { chatLlm } from "@/lib/llm";

type Doc = { title?: string; content?: string; category?: string; docNumber?: string; year?: string; articles?: { name: string; fullText?: string }[] };
type Case = { q: string; expect: string[] };
const CASES: Case[] = [
  { q: "연차휴가는 며칠인가요?", expect: ["취업 규칙", "인사 규정"] },
  { q: "출장 여비 지급 기준", expect: ["여비지급 세칙"] },
  { q: "징계의 종류는 무엇이 있나요?", expect: ["상벌운영 세칙", "인사 규정"] },
  { q: "예산 편성 절차", expect: ["예산 규정"] },
  { q: "물품 구매 계약 방법", expect: ["계약업무 처리지침"] },
  { q: "안전보건 관리체계", expect: ["안전보건관리 규정"] },
  { q: "정보보안 사고 대응", expect: ["정보보안업무 지침", "보안업무지침"] },
  { q: "갑질 당하면 어디에 신고하나요?", expect: ["직장 내 괴롭힘 예방 지침"] },
  { q: "회사 기물을 파손했을 때 배상", expect: ["직원변상에 관한 처리 지침"] },
  { q: "성적 수치심을 주는 행동 신고", expect: ["성희롱·성폭력예방 및 2차 피해방지 지침"] },
  { q: "내부 비리를 제보하면 보호받나요?", expect: ["공익신고 등의 처리 및 신고자 보호 지침"] },
  { q: "집에서 일하고 싶어요", expect: ["유연근무제 운영지침"] },
  { q: "결혼하는데 회사 지원금 있나요?", expect: ["복지후생 세칙"] },
  { q: "나이 많은 직원 임금 줄이는 제도", expect: ["임금피크제 운영지침"] },
  { q: "법인카드로 밥 먹어도 되나요?", expect: ["법인카드 관리 및 운영지침"] },
  { q: "계약심의회 위원 구성과 임기", expect: ["계약업무 처리지침", "직제 규정"] },
  { q: "상품권 구매 대금 회계처리", expect: ["계약업무 처리지침", "회계 규정"] },
  { q: "육아휴직은 얼마나 쓸 수 있나요?", expect: ["취업 규칙", "인사 규정"] },
  { q: "퇴직금은 어떻게 산정되나요?", expect: ["급여 규정", "취업 규칙"] },
  { q: "공용 차량은 누가 쓸 수 있나요?", expect: ["공용(업무용) 차량 관리지침"] },
];

const HIER = "사규는 위계가 있습니다: 규정 > 세칙 > 지침 > 편람 > 매뉴얼 > 계약서. 인용한 근거에는 「규정명」을 그대로 밝히고 '문서1' 같은 번호는 쓰지 마세요.";
// 변형 A — 이전(전부 나열·4섹션·위계 나열)
const A_SYS = "당신은 사내 사규 안내 보조입니다. 반드시 【근거 문서】에 나온 문구만 근거로 삼으세요. " + HIER +
  " 답변은 GFM 4개 섹션: `## 요약` / `## 근거` / `## 적용 순서·유의` / `## 한계·추가 확인`. `## 근거`는 위계 상위→하위 순으로 나열하고 각 항목에 「규정명」+원문을 인용하세요.";
const A_USER = (ctx: string, q: string) => `【근거 문서】(위계 상위→하위 순)\n${ctx}\n\n【질문】\n${q}\n\n위 근거로 위계 상위→하위 순서로 체계적으로 답하세요.`;
// 변형 B — 현재(직접답·선별·[참고]강등·3섹션)
const B_SYS = "당신은 사내 사규 안내 보조입니다. 【근거 문서】에 나온 문구만 근거로 삼으세요. " +
  "질문의 핵심 의도에 먼저 직접 답하고, 직접 답이 되는 규정만 인용하세요. 제공된 문서를 빠짐없이 나열하지 말고, [참고] 문서는 꼭 필요할 때만 한 줄로. 간결하게. " + HIER +
  " GFM 섹션: `## 요약`(직접 답) / `## 근거`(직접 답 규정만, 단순하면 1~2건) / `## 유의·확인`.";
const B_USER = (ctx: string, q: string) => `【근거 문서】([참고]는 그래프로 덧붙인 관련 규정 — 필요할 때만)\n${ctx}\n\n【질문】\n${q}\n\n핵심에 직접·간결하게 답하고, 직접 답이 되는 규정만 인용하세요.`;
// 변형 C — 정확성 유지(근거 규정 반드시 인용·누락금지) + 무관/[참고] 나열 안 함 + 핵심 1~3개 간결
const C_SYS = "당신은 사내 사규 안내 보조입니다. 【근거 문서】에 나온 문구만 근거로 삼으세요. " +
  "질문에 직접 답하되, **답의 근거가 되는 규정은 반드시 「규정명」으로 인용하세요(절대 빠뜨리지 말 것).** 다만 질문과 무관한 문서나 [참고]로 표시된 관련 규정까지 나열하지는 말고, 핵심 근거(보통 1~3개)만 간결하게 — 불필요한 부연·중복은 빼세요. " + HIER +
  " GFM 섹션: `## 요약`(질문에 대한 직접 답) / `## 근거`(핵심 규정만, 「규정명」+원문 짧게 인용) / `## 유의·확인`(한 줄).";
const C_USER = (ctx: string, q: string) => `【근거 문서】([참고]는 그래프로 덧붙인 관련 규정)\n${ctx}\n\n【질문】\n${q}\n\n질문에 직접·간결하게 답하세요. 답의 근거 규정은 반드시 「규정명」으로 인용하되(누락 금지), 무관하거나 [참고]인 문서는 나열하지 마세요.`;

// 변형 D — B의 구조 + A의 근거 충실도: 직접답(간결) + 근거 섹션은 조문 단위 완전 인용(누락 금지) + 무관·[참고] 인용 금지
const D_SYS = "당신은 사내 사규 안내 보조입니다. 【근거 문서】에 나온 문구만 근거로 삼으세요. " +
  "질문의 핵심 의도에 먼저 간결하게 직접 답하세요. 그 다음 근거 섹션에서는 답을 지탱하는 규정을 아끼지 마세요 — 각 항목을 「규정명」 제N조(조문명) + 핵심 원문 발췌로 적고, 답의 근거가 되는 조문은 절대 빠뜨리지 마세요. " +
  "단, 질문과 무관한 문서와 [참고]로 표시된 문서는 인용하지 마세요(무관 규정 인용 금지). " + HIER +
  " GFM 섹션: `## 요약`(직접 답, 2~4문장) / `## 근거`(답을 지탱하는 조문 전부 — 「규정명」+조문번호+원문 발췌) / `## 유의·확인`.";
const D_USER = (ctx: string, q: string) => `【근거 문서】([참고]는 그래프로 덧붙인 관련 규정 — 인용 금지)\n${ctx}\n\n【질문】\n${q}\n\n핵심에 직접 답하고, 근거 섹션에는 답을 지탱하는 조문을 「규정명」·조문번호와 함께 빠짐없이 인용하세요. 무관하거나 [참고]인 문서는 인용하지 마세요.`;

const SNIP = 1600;
function ctxA(hits: Doc[], vec: Doc[], graph: Doc[], q: string): string {
  return [...hits, ...vec, ...graph].map((d) => `「${d.title}」\n${buildRegulationSnippetForLlm(d.content ?? "", q, SNIP, d.articles).trim()}`).join("\n\n---\n\n");
}
function ctxB(hits: Doc[], vec: Doc[], graph: Doc[], from: Map<string, string>, q: string): string {
  const blocks = [
    ...hits.map((d) => `「${d.title}」\n${buildRegulationSnippetForLlm(d.content ?? "", q, SNIP, d.articles).trim()}`),
    ...vec.map((d) => `「${d.title}」 (의미검색)\n${buildRegulationSnippetForLlm(d.content ?? "", q, SNIP, d.articles).trim()}`),
    ...graph.map((d) => `[참고] 「${d.title}」 — 관련 규정(필요할 때만)\n${buildRegulationSnippetForLlm(d.content ?? "", q, 500, d.articles).trim()}`),
  ];
  return blocks.join("\n\n---\n\n");
}

const regsCited = (a: string) => new Set([...a.matchAll(/「([^」]+)」/g)].map((m) => m[1])).size;
const citesExpect = (a: string, expect: string[]) => expect.some((e) => a.includes(e));

// EVAL_LLM_* env로 명시 타겟 강제(chatLlm options.override — DB 설정 무시). 하니스 전용.
const OVERRIDE = process.env.EVAL_LLM_BASE_URL
  ? { baseURL: process.env.EVAL_LLM_BASE_URL, model: process.env.EVAL_LLM_MODEL || "", apiKey: process.env.EVAL_LLM_API_KEY || "" }
  : undefined;

async function gen(sys: string, user: string): Promise<string> {
  try { return await chatLlm([{ role: "user", content: sys + "\n\n" + user }], { maxTokens: 1500, temperature: 0.1, override: OVERRIDE }); }
  catch (e) { return "(생성실패: " + (e as Error).message + ")"; }
}

async function main() {
  await connectDb();
  const cfg = await getPlaygroundConfig();
  const rows: { q: string; inCtx: boolean; aCite: boolean; bCite: boolean; cCite: boolean; aLen: number; bLen: number; cLen: number; aRegs: number; bRegs: number; cRegs: number }[] = [];
  for (const c of CASES) {
    const hits = (await retrieveRagRegulationsForQa(c.q, 8)) as Doc[];
    const have = new Set(hits.map((h) => h.title));
    const vs = (await vectorSearchSeeds(c.q, 4, { model: cfg.embedModel, dims: cfg.embedDims, baseUrl: cfg.embedBaseUrl })).filter((v) => !have.has(v.title));
    vs.forEach((v) => have.add(v.title));
    const s = semanticTermsForRag(c.q); const terms = s.length ? s : expandTermsForRag(c.q, queryTermsFromQuestion(c.q));
    const exp = (await expandViaGraph([...hits, ...vs.map((v) => v.doc)] as Doc[], terms, 3)).filter((e) => !have.has(e.title));
    const vecDocs = vs.map((v) => v.doc as Doc); const graphDocs = exp.map((e) => e.doc as Doc);
    const inCtx = c.expect.some((e) => [...hits, ...vecDocs, ...graphDocs].some((d) => d.title === e));
    const fromMap = new Map(exp.map((e) => [e.title, e.from]));
    const cb = ctxB(hits, vecDocs, graphDocs, fromMap, c.q);
    const aAns = await gen(A_SYS, A_USER(ctxA(hits, vecDocs, graphDocs, c.q), c.q));
    const bAns = await gen(B_SYS, B_USER(cb, c.q));
    const cAns = await gen(C_SYS, C_USER(cb, c.q));
    const dAns = await gen(D_SYS, D_USER(cb, c.q));
    const r = { q: c.q, inCtx, aCite: citesExpect(aAns, c.expect), bCite: citesExpect(bAns, c.expect), cCite: citesExpect(cAns, c.expect), dCite: citesExpect(dAns, c.expect), aLen: aAns.length, bLen: bAns.length, cLen: cAns.length, dLen: dAns.length, aRegs: regsCited(aAns), bRegs: regsCited(bAns), cRegs: regsCited(cAns), dRegs: regsCited(dAns) };
    rows.push(r);
    if (process.env.EVAL_DUMP) {
      const fs = await import("node:fs");
      fs.appendFileSync(process.env.EVAL_DUMP, JSON.stringify({ q: c.q, expect: c.expect, inCtx, A: aAns, B: bAns, C: cAns, D: dAns }) + "\n");
    }
    console.log(`[${inCtx ? "ctx○" : "ctx✗"}] A:${r.aCite ? "✓" : "✗"}/${r.aLen}/${r.aRegs}  B:${r.bCite ? "✓" : "✗"}/${r.bLen}/${r.bRegs}  C:${r.cCite ? "✓" : "✗"}/${r.cLen}/${r.cRegs}  D:${r.dCite ? "✓" : "✗"}/${r.dLen}/${r.dRegs}  ${c.q}`);
  }
  const inCtx = rows.filter((r) => r.inCtx);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  console.log("\n==== 집계 (n=" + rows.length + ", 정답문서 컨텍스트포함 " + inCtx.length + ") ====");
  console.log("정답규정 인용율(ctx포함분): A " + pct(inCtx.filter((r) => r.aCite).length, inCtx.length) + "%  B " + pct(inCtx.filter((r) => r.bCite).length, inCtx.length) + "%  C " + pct(inCtx.filter((r) => r.cCite).length, inCtx.length) + "%  D " + pct(inCtx.filter((r) => (r as { dCite?: boolean }).dCite).length, inCtx.length) + "%");
  console.log("평균 답변길이:        A " + avg(rows.map((r) => r.aLen)) + "자  B " + avg(rows.map((r) => r.bLen)) + "자  C " + avg(rows.map((r) => r.cLen)) + "자  D " + avg(rows.map((r) => (r as { dLen?: number }).dLen ?? 0)) + "자");
  console.log("평균 인용 규정수:     A " + (rows.reduce((a, r) => a + r.aRegs, 0) / rows.length).toFixed(1) + "  B " + (rows.reduce((a, r) => a + r.bRegs, 0) / rows.length).toFixed(1) + "  C " + (rows.reduce((a, r) => a + r.cRegs, 0) / rows.length).toFixed(1) + "  D " + (rows.reduce((a, r) => a + ((r as { dRegs?: number }).dRegs ?? 0), 0) / rows.length).toFixed(1));
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
