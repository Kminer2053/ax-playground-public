/**
 * 통합 랜덤 50문항 — 실제 답변(gemma) 생성 A/B. 서비스 라우트(knowledge/assistant)의 프롬프트·파라미터를
 * 그대로 재현해 빠른/심층 각각 생성한다(심층의 '파악된 의도'는 "(질문 그대로)"로 고정 — 변수 제거).
 *   MONGODB_URI=... npx tsx src/scripts/eval-ab-answers.ts <before|after> <fast|deep>
 * 산출: $AB_OUT_DIR|backups/ab-answers-<tag>-<mode>.json — 답변 전문 + 자동판정(정답발화 key·근거인용 cite).
 */
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import fs from "fs";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { fastSearchRegulations, HIERARCHY_GUIDE } from "@/lib/regulations-search";

type Item = { q: string; cat: string; src: string; expectDoc: string[]; expectEvidence?: string[] };
type GoldRow = { q: string; answer?: string; expectEvidence?: string[] };

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const OUT_DIR = process.env.AB_OUT_DIR || "backups";

const DEEP_SYSTEM =
  "당신은 사내 사규 안내 보조입니다. 반드시 아래【근거 문서】에 실제로 나온 문구만 근거로 삼아 답하고, 없는 내용은 단정하지 말고 \"제공된 자료에 없음\"으로 표기하세요. " +
  HIERARCHY_GUIDE + " " +
  "답변은 GitHub Flavored Markdown으로 정확히 다음 4개 섹션 제목만 사용하세요(괄호·부연 금지): `## 요약` / `## 근거` / `## 적용 순서·유의` / `## 한계·추가 확인`. " +
  "`## 근거`는 각 규정을 `- ` 불릿으로 **별도 줄**에 작성하세요(항목마다 줄바꿈). 각 항목은 「규정명」(위계·연번)에 이어 **핵심 1~2문장만** 인용하고, 조문의 여러 호(號)를 통째로 이어 붙이지 마세요(많으면 핵심 호만 인용하거나 요약). 위계 상위→하위 순. '문서1' 같은 번호 표기는 쓰지 마세요. " +
  "`## 한계·추가 확인`에는 최종 판단은 담당 부서 확인이 필요하다는 문장을 한 줄 넣으세요. " +
  "【규정 간 관계】가 제공되면, 어떤 규정이 어떤 규정에 근거·준용·위임하는지 그 논리적 연결을 `## 근거`에서 명시해 설명하세요(예: 「A」는 「B」에 근거함).";

/** 정답(answer/evidence)에서 자동판정 키 추출 — 직급·처분·수치·폴백(evidence) */
function answerKeys(gold?: GoldRow): string[] {
  const keys: string[] = [];
  const a = gold?.answer ?? "";
  const rank = a.match(/([가-힣/·, ]{2,18}?)\s*전결/);
  if (rank && rank[1].trim().length >= 2) keys.push(rank[1].trim());
  const pun = a.match(/(파면|해임|정직|감봉|견책)(\s*[~∼\-–]\s*(파면|해임|정직|감봉|견책))?/);
  if (pun) keys.push(pun[0]);
  const num = a.match(/\d+일|\d+%|[SABCDE]\s*등급|E등급|\d+억|\d+천만원|\d+백만원|\d+만원/);
  if (num) keys.push(num[0]);
  if (!keys.length && gold?.expectEvidence?.length) keys.push(gold.expectEvidence[0]);
  return keys;
}

async function llm(system: string | undefined, user: string, maxTokens: number): Promise<string> {
  const base = (process.env.OPENAI_COMPATIBLE_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY || "x"}` },
    body: JSON.stringify({
      model: process.env.OPENAI_COMPATIBLE_MODEL || "mlx-community/gemma-4-e2b-it-4bit",
      temperature: 0.1,
      max_tokens: maxTokens,
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }],
    }),
  });
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? "";
}

async function main() {
  const tag = process.argv[2];
  const mode = process.argv[3] as "fast" | "deep";
  if (!tag || !["fast", "deep"].includes(mode)) { console.log("사용: <before|after> <fast|deep>"); process.exit(1); }

  await connectDb();
  const items: Item[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/benchmark/ab-sample-50.json"), "utf8"));
  const gold = new Map(
    (JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/benchmark/table-queries.json"), "utf8")) as GoldRow[]).map((g) => [norm(g.q), g]),
  );

  const rows: { q: string; src: string; cat: string; cite: boolean; key: boolean | null; keys: string[]; gen: string }[] = [];
  let done = 0;
  for (const it of items) {
    // 서비스 파라미터 재현: fast=5문서·900자 / deep=8문서·2000자·vec4·graph3
    const r = await fastSearchRegulations(it.q, mode === "deep" ? { maxDocs: 8, snippetLen: 2000, vecAddsMax: 4, graphMax: 3 } : undefined);
    const user = mode === "deep"
      ? `【파악된 의도】\n(질문 그대로)\n\n【근거 문서】(위계 상위→하위 순)\n${r.contextText}\n\n【질문】\n${it.q}\n\n위 근거만으로, 위계 상위→하위 순서로 체계적으로 답하세요.`
      : `아래는 사내 사규 문서입니다(위계 상위→하위 순으로 정렬됨).\n\n${r.contextText}\n\n질문: ${it.q}\n${HIERARCHY_GUIDE}\n위 문서에 나온 내용만 인용하여 답하세요. 문서에 없는 내용은 추측하지 마세요.`;
    const gen = await llm(mode === "deep" ? DEEP_SYSTEM : undefined, user, mode === "deep" ? 4096 : 3072);
    const gnorm = norm(gen);
    const cite = it.expectDoc.some((d) => gnorm.includes(norm(d)));
    const g = it.src === "표형풀" ? gold.get(norm(it.q)) : undefined;
    const keys = it.src === "표형풀" ? answerKeys(g) : [];
    const key = it.src === "표형풀" ? (keys.length ? keys.some((k) => gnorm.includes(norm(k))) : null) : null;
    rows.push({ q: it.q, src: it.src, cat: it.cat, cite, key, keys, gen });
    done++;
    console.log(`${done}/50 ${cite ? "✅" : "❌"}cite${key === null ? "" : key ? " ✅key" : " ❌key"} ${it.q.slice(0, 40)}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `ab-answers-${tag}-${mode}.json`);
  fs.writeFileSync(out, JSON.stringify({ tag, mode, rows }, null, 1));
  const keyRows = rows.filter((r) => r.key !== null);
  console.log(`\n[${tag}·${mode}] cite ${rows.filter((r) => r.cite).length}/50 · 정답발화 ${keyRows.filter((r) => r.key).length}/${keyRows.length} → ${out}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
