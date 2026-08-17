/**
 * 사규검색 품질 벤치마크 — data/benchmark/queries.json(100문항)으로 간편/심층 모두 측정.
 * 실제 엔드포인트(/api/knowledge/assistant)를 호출해 라이브 파이프라인을 그대로 평가한다.
 * A/B: 변경 전 `--label A`, 변경 후 `--label B`로 두 번 돌린 뒤 scorecard 비교.
 *
 *   node 서버 기동 후:
 *   npx tsx src/scripts/benchmark.ts --label base [--mode both|fast|deep] [--limit N]
 */
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const LABEL = arg("label", "run");
const MODE = arg("mode", "both"); // both | fast | deep
const LIMIT = parseInt(arg("limit", "0"), 10) || 0;
const BASE = process.env.BENCH_BASE || "http://localhost:3000";

type Q = { id: number; q: string; expect: string[]; cat: string };
type Res = { answer?: string; references?: { title?: string }[]; error?: string };

const REFUSE = /자료에 없|근거가 없|찾을 수 없|제공된 자료|확인하기 어렵|해당[^.]{0,6}없|관련[^.]{0,6}없/;
const regsCited = (a: string) => new Set([...a.matchAll(/「([^」]+)」/g)].map((m) => m[1])).size;

async function ask(q: string, mode: "fast" | "deep"): Promise<Res> {
  try {
    const r = await fetch(`${BASE}/api/knowledge/assistant`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, mode }), signal: AbortSignal.timeout(120000),
    });
    return (await r.json()) as Res;
  } catch (e) { return { error: (e as Error).message }; }
}

type Row = { id: number; cat: string; mode: string; recall: boolean; cite: boolean; refused: boolean; len: number; regs: number };

async function runMode(qs: Q[], mode: "fast" | "deep"): Promise<Row[]> {
  const rows: Row[] = [];
  for (const item of qs) {
    const r = await ask(item.q, mode);
    const ans = r.answer ?? "";
    const refs = (r.references ?? []).map((x) => String(x.title ?? ""));
    const isNeg = item.cat === "범위밖";
    const recall = isNeg ? false : item.expect.some((e) => refs.includes(e));
    const cite = isNeg ? false : item.expect.some((e) => ans.includes(e));
    const refused = REFUSE.test(ans) || refs.length === 0;
    rows.push({ id: item.id, cat: item.cat, mode, recall, cite, refused, len: ans.length, regs: regsCited(ans) });
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return rows;
}

function scorecard(rows: Row[]) {
  const cats = ["직접", "의미", "참조", "범위밖"];
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const card: Record<string, unknown> = {};
  for (const mode of [...new Set(rows.map((r) => r.mode))]) {
    const m = rows.filter((r) => r.mode === mode);
    const ans = m.filter((r) => r.cat !== "범위밖");
    const neg = m.filter((r) => r.cat === "범위밖");
    const byCat: Record<string, string> = {};
    for (const c of cats) {
      const cr = m.filter((r) => r.cat === c);
      if (!cr.length) continue;
      byCat[c] = c === "범위밖"
        ? `정확거절 ${pct(cr.filter((r) => r.refused).length, cr.length)}%`
        : `회수 ${pct(cr.filter((r) => r.recall).length, cr.length)}% · 인용 ${pct(cr.filter((r) => r.cite).length, cr.length)}%`;
    }
    card[mode] = {
      회수율: pct(ans.filter((r) => r.recall).length, ans.length),
      정답인용율: pct(ans.filter((r) => r.cite).length, ans.length),
      범위밖_정확거절: pct(neg.filter((r) => r.refused).length, neg.length || 1),
      평균길이: Math.round(ans.reduce((a, r) => a + r.len, 0) / (ans.length || 1)),
      평균인용규정: +(ans.reduce((a, r) => a + r.regs, 0) / (ans.length || 1)).toFixed(1),
      카테고리별: byCat,
    };
  }
  return card;
}

async function main() {
  const qs0: Q[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/benchmark/queries.json"), "utf8"));
  const qs = LIMIT ? qs0.slice(0, LIMIT) : qs0;
  console.log(`벤치마크 [${LABEL}] — ${qs.length}문항 · 모드=${MODE} · ${BASE}`);
  const rows: Row[] = [];
  if (MODE === "fast" || MODE === "both") { console.log("간편검색..."); rows.push(...(await runMode(qs, "fast"))); }
  if (MODE === "deep" || MODE === "both") { console.log("심층검색..."); rows.push(...(await runMode(qs, "deep"))); }
  const card = scorecard(rows);
  console.log("\n==== Scorecard [" + LABEL + "] ====");
  console.log(JSON.stringify(card, null, 2));
  const outDir = path.join(process.cwd(), "data/benchmark/results");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `result-${LABEL}.json`);
  fs.writeFileSync(out, JSON.stringify({ label: LABEL, mode: MODE, n: qs.length, card, rows }, null, 1));
  console.log("저장:", out);
}
main().catch((e) => { console.error(e); process.exit(1); });
