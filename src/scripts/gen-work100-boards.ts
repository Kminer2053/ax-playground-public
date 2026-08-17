/**
 * M2c-3 보드 생성 — Task별 board-v1(스윔레인) 저작 + 렌더 게이트(validate --strict / audit).
 * refs는 업무근거 엣지에서 기계 생성(manifest board_mapping — 역파싱 금지).
 * 게이트 실패 사유는 재생성 프롬프트에 피드백(validate-render 루프, 최대 3회).
 * 통과 보드는 data/work100/boards/<taskId>.board.json + work100_boards 컬렉션(candidate).
 *
 * 실행: MONGODB_URI=... npx tsx src/scripts/gen-work100-boards.ts [--task task:...] [--dept 경영지원처] [--all]
 *   KOREA100_DIR=<korea100studio 경로>(기본: vendor/korea100studio) · BOARD_PROFILE=<보드 프로파일>(기본: gov)
 */
import path from "path";
import fs from "fs";
import os from "os";
import { execFileSync } from "child_process";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { OntologyEdgeModel } from "@/models/OntologyEdge";
import { RagRegulationModel } from "@/models/RagRegulation";
import { chatLlm } from "@/lib/llm";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ONLY_TASK = arg("task");
const ONLY_DEPT = arg("dept");
const ALL = process.argv.includes("--all");
const SKIP_EXISTING = process.argv.includes("--skip-existing");
const K100 = process.env.KOREA100_DIR ?? path.join(process.cwd(), "vendor/korea100studio"); // 벤더 고정(임시폴더 클론 금지 — 소실 사고 실증)
/** 보드 렌더 프로파일 — 기본 gov(공공 일반). BOARD_PROFILE 로 재정의. */
const BOARD_PROFILE = process.env.BOARD_PROFILE || "gov";
const OUT_DIR = path.join(process.cwd(), "data/work100/boards");
const AT = new Date().toISOString();

const SYS =
  "당신은 업무 절차 설계가입니다. 하나의 업무와 그 근거 조문들을 받아 스윔레인 보드(board-v1 JSON)를 저작합니다.\n" +
  "규칙:\n" +
  "① lanes = 행위자(요청 부서·담당 부서·심의기구·전결권자 등 2~4개, 짧게). stages = 시간 순 단계(G0~G3 형식 코드 접두, 3~4개).\n" +
  "② nodes = (lane, stage)당 업무 카드 1~2개. id는 n1,n2…, lane·stage는 위 배열 문자열을 그대로 복사(변형 금지). label은 짧은 동사구.\n" +
  "③ edges = id e1,e2…, source/target은 실존 노드 id, type 필수: sequence(순방향)|message(정보 전달)|loop(반려·보완 회귀). label은 분기 조건. 기본은 인접 노드 순차 사슬(n1→n2→n3…) — 멀리 떨어진 노드로 건너뛰는 연결·과다한 분기는 금지(레이아웃 관통·교차 유발).\n" +
  "④ emphasis: lead(개시)·key(핵심 1~2개)·bottleneck(지연 유발)·loop(재진입)·normal. 과다 마킹 금지.\n" +
  "⑤ 절차는 제공된 근거 조문 내용에 기반하되, 조문에 없는 단계는 일반 상식 수준만 최소로.\n" +
  "반드시 JSON 객체 하나만 출력(코드블록·설명 금지): {\"lanes\":[…],\"stages\":[…],\"nodes\":[{\"id\":\"n1\",\"lane\":\"…\",\"stage\":\"…\",\"label\":\"…\",\"emphasis\":\"lead\",\"note\":\"…\"}],\"edges\":[{\"id\":\"e1\",\"source\":\"n1\",\"target\":\"n2\",\"type\":\"sequence\"}]}";

function extractJson(raw: string): Record<string, unknown> {
  let s = raw.replace(/```json?/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    return JSON.parse(s);
  } catch {
    // 꼬리따옴표 수리(E4B 간헐 오류)는 1차 파싱 실패 시에만 — 정상 JSON의 ""(빈 문자열)을 훼손하지 않도록
    return JSON.parse(s.replace(/([\]\d"])\s*"(?=\s*[,}\]])/g, "$1"));
  }
}

type Ground = {
  to: { doc: string; name: string; srcHash?: string };
  props?: { basis?: string; note?: string };
  status?: string;
};

/** 게이트: korea100studio validate --strict + audit(관통 0). 실패 사유 문자열 반환(통과면 null). */
function gate(boardPath: string): { ok: boolean; report: string; score?: number } {
  try {
    execFileSync("node", [path.join(K100, "scripts/board.mjs"), "validate", boardPath, "--strict", "--profile", BOARD_PROFILE], { stdio: "pipe" });
    const out = execFileSync("node", [path.join(K100, "scripts/board.mjs"), "audit", boardPath, "--json", "--profile", BOARD_PROFILE], { stdio: "pipe" }).toString();
    const audit = JSON.parse(out);
    if (audit?.metrics?.nodePiercings > 0) return { ok: false, report: `nodePiercings=${audit.metrics.nodePiercings}(무관용) — 스테이지 재배열·노드 분할 필요` };
    return { ok: true, report: "통과", score: audit?.score };
  } catch (e) {
    let msg = e instanceof Error && "stderr" in e ? String((e as { stderr?: Buffer }).stderr ?? e.message) : String(e);
    // "Budget violations for <임시경로>:" 헤더 제거, 위반 상세만 남기고 수정 지침 번역
    msg = msg.replace(/Budget violations for [^\n]+:?/g, "레이아웃 예산 위반:").trim();
    const advice: string[] = [];
    if (/piercing/.test(msg)) advice.push("관통(piercing) → 노드 수를 줄이고(레인·스테이지당 1개), 엣지는 인접 노드끼리 순차 사슬(n1→n2→n3…)로만 — 멀리 건너뛰는 연결 금지");
    if (/crossings/.test(msg)) advice.push("교차(crossings) 초과 → 레인 순서를 흐름 방향(좌→우)으로 재배열하고 레인을 건너뛰는 엣지·message 엣지를 줄이세요");
    if (/bends|stretch/.test(msg)) advice.push("굴곡·우회 초과 → 멀리 떨어진 노드 간 직접 연결을 피하고 인접 스테이지로 잇는 순차 흐름으로 단순화하세요");
    if (/adjusted-labels|label/.test(msg)) advice.push("라벨 밀집 → 엣지 label 수를 줄이세요(분기 조건만)");
    return { ok: false, report: `${msg.slice(0, 300)}${advice.length ? `\n지침: ${advice.join(" / ")}` : ""}` };
  }
}

async function buildOne(task: { id: string; label: string; desc: string; dept: string; steps?: string[]; org?: string }) {
  // 근거·컨텍스트 수집
  const grounds = (await OntologyEdgeModel.find({ rel: "업무근거", from: task.id }).select("to props status").lean()) as unknown as Ground[];
  const jeol = await OntologyEdgeModel.find({ rel: "전결", from: task.id }).select("to props evidence").lean<
    { to: string; props?: { limit?: { text?: string } }; evidence?: { quote?: string } }[]
  >();
  const positions = [...new Set(jeol.map((j) => String(j.to).replace("position:", "")))];
  // refs 기계 생성(중복 제거) + 절차 재료(조문 발췌)
  const seen = new Set<string>();
  const refs: { source: string; note?: string; _anchor: Record<string, unknown> }[] = [];
  const matBlocks: string[] = [];
  for (const g of grounds) {
    const key = `${g.to.doc}#${g.to.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const jo = g.to.name.match(/^(제\d+조|별표 제\d+호|별지 제\d+호 서식)/)?.[1] ?? g.to.name;
    refs.push({ source: `「${g.to.doc}」 ${jo}`, note: g.props?.note ?? "", _anchor: { ...g.to, basis: g.props?.basis } });
    if (matBlocks.length < 6 && (g.props?.basis === "절차" || g.props?.basis === "기준")) {
      const d = await RagRegulationModel.findOne({ title: g.to.doc }, { articles: 1 }).lean<{ articles: { name: string; fullText?: string }[] }>();
      const a = d?.articles.find((x) => x.name === g.to.name);
      if (a?.fullText) matBlocks.push(`「${g.to.doc}」 ${g.to.name}:\n${a.fullText.replace(/\s+/g, " ").slice(0, 500)}`);
    }
  }

  const user =
    `업무: ${task.label} — ${task.desc}\n소관 부서: ${task.dept}${task.org === "현업" ? " (현장 집행 업무)" : ""}` +
    (task.steps?.length ? `\n확정 절차 단계(스테이지 골격으로 사용): ${task.steps.join(" → ")}` : "") +
    (positions.length ? `\n전결권자: ${positions.join(", ")}` : "") +
    `\n\n[근거 조문 발췌]\n${matBlocks.join("\n\n") || "(발췌 없음 — 일반 절차로 구성)"}\n\n` +
    `이 업무의 스윔레인 보드를 저작하세요. JSON 하나만.`;

  let lastReport = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    // 재시도가 누적될수록 복잡도를 강제로 낮춤(관통·교차는 노드/엣지 과다에서 발생)
    const tighten = attempt >= 2 ? `\n\n[강한 제약] 노드는 최대 ${Math.max(4, 7 - attempt)}개, 스테이지 최대 3개, 엣지는 순차 사슬만(분기·message 최소화). 세부는 note로 접고 카드 수를 줄이세요.` : "";
    const prompt = (attempt === 1 ? user : `${user}\n\n[이전 시도 게이트 실패 — 수정 필요]\n${lastReport}`) + tighten;
    let core: Record<string, unknown>;
    let raw = "";
    try {
      raw = await chatLlm([{ role: "user", content: prompt }], { system: SYS, maxTokens: 4096, temperature: attempt === 1 ? 0.2 : 0.4 });
    } catch (e) {
      // API 오류(레이트리밋 등) — 모델 잘못이 아니므로 백오프 후 같은 프롬프트 재시도
      lastReport = `API 오류: ${String(e).slice(0, 120)}`;
      await new Promise((r) => setTimeout(r, 8000 * attempt));
      continue;
    }
    try {
      core = extractJson(raw);
    } catch (e) {
      if (process.env.BOARD_DEBUG) {
        fs.mkdirSync(path.join(OUT_DIR, "_debug"), { recursive: true });
        fs.writeFileSync(path.join(OUT_DIR, "_debug", `${task.id.replace(/[:/]/g, "_")}-a${attempt}.txt`), `${String(e)}\n---RAW---\n${raw}`);
      }
      lastReport = "JSON 파싱 실패 — 유효한 JSON 하나만 출력";
      continue;
    }
    // nodes에 refs 기계 부착 — 토큰 매칭(조문 note·문서명 ↔ 노드 label·note)으로 관련 카드에, 무매칭은 lead 노드로
    const nodes = (core.nodes as Record<string, unknown>[]) ?? [];
    const tok = (s: string) => new Set(String(s).split(/[\s·,()「」]+/).filter((w) => w.length >= 2));
    const lead = nodes.findIndex((n) => n.emphasis === "lead");
    const cnt = new Array(nodes.length).fill(0);
    for (const r of refs) {
      const rt = tok(`${r.source} ${r.note ?? ""}`);
      let best = lead >= 0 ? lead : 0;
      let bestS = 0;
      nodes.forEach((n, i) => {
        if (cnt[i] >= 3) return;
        let s = 0;
        for (const w of tok(`${n.label} ${n.note ?? ""}`)) if (rt.has(w)) s++;
        if (s > bestS) { bestS = s; best = i; }
      });
      if (cnt[best] >= 3) best = cnt.findIndex((c) => c < 3);
      if (best < 0) break;
      ((nodes[best].refs ??= []) as { source: string; note?: string }[]).push({ source: r.source, note: r.note });
      cnt[best]++;
    }
    const board = {
      schema_version: 1,
      title: task.label,
      subtitle: `${task.dept} 업무 절차(자동 생성 후보)`,
      profile: BOARD_PROFILE,
      ...core,
      nodes,
    };
    const tmp = path.join(os.tmpdir(), `board-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(board));
    const g = gate(tmp);
    fs.unlinkSync(tmp);
    if (g.ok) return { board, refs, score: g.score, attempts: attempt };
    lastReport = g.report;
  }
  return { board: null, refs, score: null, attempts: 3, fail: lastReport };
}

async function main() {
  await connectDb();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const q: Record<string, unknown> = { type: "Task" };
  if (ONLY_TASK) q.id = ONLY_TASK;
  else if (!ALL) q["props.dept"] = ONLY_DEPT ?? "경영지원처";
  const tasks = (await OntologyNodeModel.find(q).select("id label props").lean<
    { id: string; label: string; props: { desc?: string; dept?: string; steps?: string[]; org?: string } }[]
  >()).map((t) => ({ id: t.id, label: t.label, desc: t.props?.desc ?? "", dept: t.props?.dept ?? "", steps: t.props?.steps ?? [], org: t.props?.org ?? "본사" }));
  if (!tasks.length) throw new Error("대상 Task 없음");

  const db = mongoose.connection.db!;
  const coll = db.collection("work100_boards");
  let ok = 0;
  let fail = 0;
  let skipped = 0;
  for (const t of tasks) {
    if (SKIP_EXISTING && fs.existsSync(path.join(OUT_DIR, `${t.id.replace(/[:/]/g, "_")}.board.json`))) {
      skipped++;
      continue;
    }
    const r = await buildOne(t);
    if (!r.board) {
      fail++;
      console.log(`  ✗ ${t.dept}/${t.label} — 게이트 3회 실패: ${String(r.fail).slice(0, 80)}`);
      continue;
    }
    ok++;
    const file = path.join(OUT_DIR, `${t.id.replace(/[:/]/g, "_")}.board.json`);
    fs.writeFileSync(file, JSON.stringify({ taskId: t.id, board: r.board, refsAnchors: r.refs.map((x) => x._anchor), audit: { score: r.score }, generatedAt: AT }, null, 1));
    await coll.updateOne(
      { taskId: t.id },
      // refsAnchors: 생성 시점에 어떤 근거로 만들었는지. 파일에만 두면 "그 뒤 근거가 바뀌었나"를 DB로 알 수 없다.
      { $set: { taskId: t.id, board: r.board, refsAnchors: r.refs.map((x) => x._anchor), audit: { score: r.score }, status: "candidate", updatedAt: new Date() } },
      { upsert: true },
    );
    console.log(`  ✓ ${t.dept}/${t.label} — 게이트 통과(score ${r.score}, ${r.attempts}회차) · refs ${r.refs.length}`);
  }
  console.log(`\n[대사] 보드 ${ok} 통과 / ${fail} 실패(재검토 큐)${skipped ? ` / ${skipped} 스킵(기존)` : ""}`);
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
