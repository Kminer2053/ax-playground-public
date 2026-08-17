/**
 * 약식 품질테스트 — 100문항 중 유형별 랜덤 10문항을 추출(1회 고정)해 현재 라우트 답변을 캡처.
 * A/B: 변경 전 `--label A`, 변경 후 `--label B`로 두 번 → build-quick-compare.py 로 좌우 비교 HTML.
 *   npx tsx src/scripts/quick-eval.ts --label A [--resample] [--mode fast|deep|both]
 */
import fs from "fs";
import path from "path";
import { secureShuffle } from "@/lib/random";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (k: string) => argv.includes("--" + k);
const LABEL = arg("label", "A");
const MODE = arg("mode", "both");
const SAMPLE_OVERRIDE = arg("sample", ""); // 커스텀 표본 파일(있으면 추출 대신 그대로 사용)
const BASE = process.env.BENCH_BASE || "http://localhost:3000";
const SAMPLE_PATH = path.join(process.cwd(), "data/benchmark/results/quick-sample.json");

type Q = { id: number; q: string; expect: string[]; cat: string };
// 유형별 추출 정원(총 10) — 분포(직접30/의미50/참조12/범위밖8) 반영하되 전 유형 커버
const QUOTA: Record<string, number> = { 의미: 4, 직접: 3, 참조: 2, 범위밖: 1 };

function sample(): Q[] {
  const all: Q[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/benchmark/queries.json"), "utf8"));
  const out: Q[] = [];
  for (const [cat, n] of Object.entries(QUOTA)) {
    const pool = secureShuffle(all.filter((q) => q.cat === cat));
    out.push(...pool.slice(0, n));
  }
  return out;
}

function getSample(): Q[] {
  if (SAMPLE_OVERRIDE) return JSON.parse(fs.readFileSync(SAMPLE_OVERRIDE, "utf8"));
  if (!has("resample") && fs.existsSync(SAMPLE_PATH)) return JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));
  const s = sample();
  fs.mkdirSync(path.dirname(SAMPLE_PATH), { recursive: true });
  fs.writeFileSync(SAMPLE_PATH, JSON.stringify(s, null, 1));
  console.log("새 표본 10문항 추출·고정:", SAMPLE_PATH);
  return s;
}

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
  const qs = getSample();
  const modes = (MODE === "both" ? ["fast", "deep"] : [MODE]) as ("fast" | "deep")[];
  const out: Record<string, unknown>[] = [];
  for (const s of qs) {
    for (const mode of modes) {
      const { answer, refs } = await ask(s.q, mode);
      out.push({ q: s.q, cat: s.cat, expect: s.expect, mode, answer, refs, len: answer.length });
      process.stdout.write(`[${LABEL}] ${mode} ${s.cat} ✓ (${answer.length}자)\n`);
    }
  }
  fs.writeFileSync(`/tmp/quick_${LABEL}.json`, JSON.stringify(out, null, 1));
  console.log("저장: /tmp/quick_" + LABEL + ".json");
}
main().catch((e) => { console.error(e); process.exit(1); });
