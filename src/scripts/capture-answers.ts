/**
 * 질적 비교용 — 같은 질문 샘플에 대해 현재 라우트 상태의 실제 답변을 캡처.
 * 라우트를 baseline/v1/v1b로 전환하며 각각 실행해 답변 내용을 모은다.
 *   npx tsx src/scripts/capture-answers.ts <label>
 */
import fs from "fs";

const LABEL = process.argv[2] || "cur";
const BASE = process.env.BENCH_BASE || "http://localhost:3000";

const SAMPLE = [
  { q: "연차휴가는 며칠인가요?", cat: "직접", expect: ["취업 규칙", "인사 규정"] },
  { q: "출장 여비 지급 기준", cat: "직접", expect: ["여비지급 세칙"] },
  { q: "갑질 당하면 어디에 신고하나요?", cat: "의미", expect: ["직장 내 괴롭힘 예방 지침"] },
  { q: "상품권 구매 대금 회계처리", cat: "참조", expect: ["계약업무 처리지침", "회계 규정"] },
  { q: "계약심의회 위원 구성과 임기", cat: "참조", expect: ["계약업무 처리지침", "직제 규정"] },
  { q: "구내식당 오늘 메뉴 알려줘", cat: "범위밖", expect: [] },
];

async function ask(q: string, mode: "fast" | "deep") {
  try {
    const r = await fetch(`${BASE}/api/knowledge/assistant`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, mode }), signal: AbortSignal.timeout(120000),
    });
    const d = (await r.json()) as { answer?: string; references?: { title?: string }[] };
    return { answer: d.answer ?? "", refs: (d.references ?? []).map((x) => String(x.title ?? "")) };
  } catch (e) { return { answer: "(오류: " + (e as Error).message + ")", refs: [] as string[] }; }
}

async function main() {
  const out: Record<string, unknown>[] = [];
  for (const s of SAMPLE) {
    for (const mode of ["fast", "deep"] as const) {
      const { answer, refs } = await ask(s.q, mode);
      out.push({ q: s.q, cat: s.cat, expect: s.expect, mode, answer, refs, len: answer.length });
      process.stdout.write(`[${LABEL}] ${mode} ${s.cat} ✓ (${answer.length}자)\n`);
    }
  }
  fs.writeFileSync(`/tmp/ans_${LABEL}.json`, JSON.stringify(out, null, 1));
  console.log("저장: /tmp/ans_" + LABEL + ".json");
}
main().catch((e) => { console.error(e); process.exit(1); });
