/**
 * 업무탐색 3D 샘플 시드 — 가상 조직의 온톨로지(부서·업무·근거)와 업무 흐름 보드를 빈 DB에 적재한다.
 *
 * 공개판에는 실조직 데이터가 없어 /knowledge 의 업무탐색 3D 화면이 빈 공간으로 뜬다.
 * 이 스크립트는 실재하지 않는 기관을 가정한 샘플(data/work100/sample/work-explore-sample.json)로
 * ontology_nodes · ontology_edges · work100_boards 를 채워 화면을 그대로 체험할 수 있게 한다.
 * 기관 도입 시에는 JSON만 자기 조직 값으로 교체하면 된다(스크립트 수정 불필요).
 *
 * 적재 경로는 실파이프라인과 동일하다 — 노드·엣지는 매니페스트 검증기(putNode/putEdge)를 경유하고,
 * 보드는 vendor/korea100studio 의 validate --strict + audit(관통 0) 게이트를 통과한 것만 저장한다.
 * 즉 이 샘플이 적재된다는 사실 자체가 스키마 정합성 검증이다.
 *
 * 실행:
 *   MONGODB_URI=mongodb://127.0.0.1:27017 MONGODB_DB=axplayground npm run seed:work-sample
 *   옵션: --dry(검증만·DB 미기록) · --clean(이전에 적재한 샘플 제거 후 종료) · --profile <보드 프로파일>
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
import { env } from "@/lib/env";
import { collectionName } from "@/lib/collections";
import { OntologyNodeModel } from "@/models/OntologyNode";
import { OntologyEdgeModel } from "@/models/OntologyEdge";
import { RagRegulationModel } from "@/models/RagRegulation";
import { putNode, putEdge, type Provenance } from "@/lib/ontology-store";
import { makeSlug, manifestSummary } from "@/lib/ontology-manifest";

const DRY = process.argv.includes("--dry");
const CLEAN = process.argv.includes("--clean");
const PROFILE = (() => {
  const i = process.argv.indexOf("--profile");
  return i >= 0 ? process.argv[i + 1] : "gov";
})();

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "data/work100/sample/work-explore-sample.json");
const BOARD_CLI = path.join(ROOT, "vendor/korea100studio/scripts/board.mjs");
const AT = new Date().toISOString();
/** 손으로 작성한 가상 데이터 — 규칙·LLM 도출이 아니므로 human. */
const PROV: Provenance = { method: "human", at: AT };
/** 샘플 표식 — --clean 이 이 표식만 지운다(기관 실데이터는 건드리지 않음). */
const MARK = { sample: true } as const;

// ── 샘플 데이터 타입(JSON 스키마) ─────────────────────────────
type Anchor = { doc: string; name: string; quote?: string };
type SampleDept = { label: string; parent: string | null; kind: string; deptPath: string; honbu: string; order: number };
type SampleFn = { domain: string; subs: string[] };
type Limit = { min: number | null; max: number | null; text: string } | null;
type SampleBoardNode = { id: string; lane: string; stage: string; label: string; emphasis?: string; note?: string; refs?: number[] };
type SampleBoard = {
  lanes: string[];
  stages: string[];
  nodes: SampleBoardNode[];
  edges: { id: string; source: string; target: string; type: string; label?: string }[];
};
type SampleTask = {
  label: string;
  desc: string;
  dept: string;
  org: string;
  fn: string;
  steps: string[];
  status: "candidate" | "validated" | "promoted";
  alsoDepts?: string[];
  linkedToHQ?: string;
  ownership: { duty: string; evidence: Anchor };
  approval: { position: string; limit?: Limit; note?: string; evidence: Anchor }[];
  basis: { doc: string; name: string; basis: string; note?: string; quote?: string }[];
  board: SampleBoard;
};
type SampleData = {
  docs: { title: string; use: string }[];
  depts: SampleDept[];
  functions: SampleFn[];
  tasks: SampleTask[];
  precedes: { from: string; to: string; note?: string }[];
  collabs: { a: string; b: string; note?: string }[];
};

// ── 보드 게이트·렌더(vendor korea100studio) ────────────────────
/** board-v1 스키마 + 구성 예산 검사. 관통(nodePiercings)은 무관용. */
function gate(board: unknown): { ok: boolean; report: string; score?: number } {
  const tmp = path.join(os.tmpdir(), `wsample-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(board));
  try {
    execFileSync("node", [BOARD_CLI, "validate", tmp, "--strict", "--profile", PROFILE], { stdio: "pipe" });
    const audit = JSON.parse(execFileSync("node", [BOARD_CLI, "audit", tmp, "--json", "--profile", PROFILE], { stdio: "pipe" }).toString());
    if (audit?.metrics?.nodePiercings > 0) return { ok: false, report: `nodePiercings=${audit.metrics.nodePiercings}(무관용)` };
    return { ok: true, report: "통과", score: audit?.score };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const msg = String(err.stderr ?? err.stdout ?? err.message ?? e).trim();
    return { ok: false, report: msg.slice(0, 400) };
  } finally {
    fs.unlinkSync(tmp);
  }
}

/** 보드 JSON → SVG(정적·모션). board.mjs 는 파일 입력만 받으므로 임시파일 경유. */
function render(board: unknown, mode: "render" | "motion"): string {
  const tmp = path.join(os.tmpdir(), `wsample-r-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(board));
  try {
    const out = execFileSync("node", [BOARD_CLI, mode, tmp, "--out", "/dev/stdout", "--profile", PROFILE], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    }).toString();
    // board.mjs 는 SVG 뒤에 출력 경로를 한 줄 더 찍는다 — 닫는 태그까지만 남긴다.
    const end = out.lastIndexOf("</svg>");
    return end >= 0 ? out.slice(0, end + 6) : out;
  } finally {
    fs.unlinkSync(tmp);
  }
}

/** 모션 SVG 규약(cache-work100-boards.mjs 와 동일): 전 id `_m` 접미 + repeatCount 1 + fill=freeze. */
function normalizeMotion(input: string): string {
  let svg = input;
  const ids = [...new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))];
  for (const id of ids) {
    const e = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    svg = svg
      .replace(new RegExp(`\\bid="${e}"`, "g"), `id="${id}_m"`)
      .replace(new RegExp(`url\\(#${e}\\)`, "g"), `url(#${id}_m)`)
      .replace(new RegExp(`(\\bhref|xlink:href)="#${e}"`, "g"), `$1="#${id}_m"`)
      .replace(new RegExp(`\\bbegin="${e}\\.`, "g"), `begin="${id}_m.`);
  }
  svg = svg.replace(/repeatCount="indefinite"/g, 'repeatCount="1"');
  return svg.replace(/<animate\b([^>]*?)\s*\/>/g, (full, attrs: string) => (/\bfill=/.test(attrs) ? full : `<animate${attrs} fill="freeze"/>`));
}

/** 조문명 → 보드 refs 표시용 약칭(제12조 · 별표 제2호). */
const shortName = (name: string) => name.match(/^(제\d+조|별표 제\d+호|별지 제\d+호 서식)/)?.[1] ?? name;

// ── 적재 ──────────────────────────────────────────────────────
async function clean() {
  const db = mongoose.connection.db!;
  const n = await OntologyNodeModel.deleteMany({ "props.sample": true });
  const e = await OntologyEdgeModel.deleteMany({ "props.sample": true });
  const b = await db.collection(collectionName("work100Boards")).deleteMany({ sample: true });
  console.log(`[정리] 노드 ${n.deletedCount} · 엣지 ${e.deletedCount} · 보드 ${b.deletedCount} 삭제(샘플 표식만)`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as SampleData;
  console.log(`[업무탐색 샘플 시드] 매니페스트 ${manifestSummary().version} · 보드 프로파일 ${PROFILE}${DRY ? " · dry" : ""}`);

  if (CLEAN) {
    await connectDb();
    console.log(`  DB: ${env.MONGODB_DB}`);
    await clean();
    return;
  }

  // 보드 게이트를 DB 접속 전에 — 데이터가 깨졌으면 아무것도 쓰지 않는다.
  const boards = new Map<string, { board: Record<string, unknown>; refsAnchors: Record<string, unknown>[]; score?: number }>();
  for (const t of data.tasks) {
    const taskId = makeSlug("task", t.label);
    const nodes = t.board.nodes.map((n) => {
      const refs = (n.refs ?? []).map((i) => {
        const b = t.basis[i];
        if (!b) throw new Error(`${t.label} 보드 노드 ${n.id}: basis[${i}] 없음`);
        return { source: `「${b.doc}」 ${shortName(b.name)}`, note: b.note ?? "" };
      });
      const card: Record<string, unknown> = { id: n.id, lane: n.lane, stage: n.stage, label: n.label };
      if (n.emphasis) card.emphasis = n.emphasis;
      if (n.note) card.note = n.note;
      if (refs.length) card.refs = refs;
      return card;
    });
    const board = {
      schema_version: 1,
      title: t.label,
      subtitle: `${t.dept} 업무 절차(가상 샘플)`,
      profile: PROFILE,
      lanes: t.board.lanes,
      stages: t.board.stages,
      nodes,
      edges: t.board.edges,
    };
    const g = gate(board);
    if (!g.ok) throw new Error(`보드 게이트 실패 — ${t.label}\n${g.report}`);
    boards.set(taskId, {
      board,
      refsAnchors: t.basis.map((b) => ({ doc: b.doc, name: b.name, basis: b.basis })),
      score: g.score,
    });
    console.log(`  ✓ 보드 게이트 통과: ${t.label}(구성점수 ${g.score})`);
  }

  if (DRY) {
    console.log(`[dry] 보드 ${boards.size}건 게이트 통과 — DB 미기록`);
    return;
  }

  await connectDb();
  console.log(`  DB: ${env.MONGODB_DB}`);

  const count = { node: 0, edge: 0, board: 0 };
  const deptId = new Map<string, string>();

  // ① 조직축 — 부서 + 부서상하
  for (const d of data.depts) {
    const id = await putNode({
      space: "org",
      type: "Dept",
      label: d.label,
      props: { deptPath: d.deptPath, honbu: d.honbu, kind: d.kind, order: d.order, ...MARK },
      status: "promoted",
      provenance: PROV,
    });
    deptId.set(d.label, id);
    count.node++;
  }
  for (const d of data.depts) {
    if (!d.parent) continue;
    await putEdge({
      rel: "부서상하",
      from: deptId.get(d.label)!,
      to: deptId.get(d.parent)!,
      fromSpace: "org",
      fromType: "Dept",
      toSpace: "org",
      toType: "Dept",
      props: { ...MARK },
      status: "promoted",
      // 부서 상하관계는 샘플 데이터(depts[].parent)가 근거 — 동봉 샘플 사규에는 직제 조문이 없어 근거 앵커를 걸지 않는다.
      provenance: PROV,
    });
    count.edge++;
  }

  // ② 개념축 — 기능(대분류·세부) + 상위분류
  const fnId = new Map<string, string>();
  for (const f of data.functions) {
    const domainId = await putNode({
      space: "concept",
      type: "Function",
      label: f.domain,
      props: { domain: f.domain, level: "domain", ...MARK },
      status: "promoted",
      provenance: PROV,
    });
    fnId.set(f.domain, domainId);
    count.node++;
    for (const sub of f.subs) {
      const subId = await putNode({
        space: "concept",
        type: "Function",
        label: sub,
        props: { domain: f.domain, level: "sub", ...MARK },
        status: "promoted",
        provenance: PROV,
      });
      fnId.set(`${f.domain}>${sub}`, subId);
      count.node++;
      await putEdge({
        rel: "상위분류",
        from: subId,
        to: domainId,
        fromSpace: "concept",
        fromType: "Function",
        toSpace: "concept",
        toType: "Function",
        props: { ...MARK },
        status: "promoted",
        provenance: PROV,
      });
      count.edge++;
    }
  }

  // ③ 직위(전결권자) — 매니페스트 닫힌 목록 검증 경유
  for (const label of new Set(data.tasks.flatMap((t) => t.approval.map((a) => a.position)))) {
    await putNode({ space: "org", type: "Position", label, props: { ...MARK }, status: "promoted", provenance: PROV });
    count.node++;
  }

  // ④ 업무축 — Task + 소관·전결·업무근거·기능분류
  for (const t of data.tasks) {
    const taskId = await putNode({
      space: "work",
      type: "Task",
      label: t.label,
      props: {
        dept: t.dept,
        desc: t.desc,
        fn: t.fn,
        org: t.org,
        steps: t.steps,
        alsoDepts: t.alsoDepts ?? [],
        linkedToHQ: t.linkedToHQ ?? null,
        boardId: makeSlug("task", t.label),
        ...MARK,
      },
      status: t.status,
      provenance: PROV,
    });
    count.node++;
    const st = t.status; // 엣지 수명주기는 업무 노드와 동일(승격 게이트: 양단 노드 promoted)

    const dept = deptId.get(t.dept);
    if (!dept) throw new Error(`${t.label}: 소관 부서 미정의(${t.dept})`);
    await putEdge({
      rel: "소관",
      from: taskId,
      to: dept,
      fromSpace: "work",
      fromType: "Task",
      toSpace: "org",
      toType: "Dept",
      props: { ...MARK },
      status: st,
      rtConf: "상",
      evidence: { ...t.ownership.evidence },
      provenance: PROV,
    });
    count.edge++;

    for (const a of t.approval) {
      await putEdge({
        rel: "전결",
        from: taskId,
        to: makeSlug("position", a.position),
        fromSpace: "work",
        fromType: "Task",
        toSpace: "org",
        toType: "Position",
        props: { limit: a.limit ?? null, positionRule: a.note, ...MARK },
        status: st,
        rtConf: "상",
        evidence: { ...a.evidence },
        provenance: PROV,
      });
      count.edge++;
    }

    for (const b of t.basis) {
      await putEdge({
        rel: "업무근거",
        from: taskId,
        to: { doc: b.doc, name: b.name },
        fromSpace: "work",
        fromType: "Task",
        toSpace: "corpus",
        toType: "Article",
        props: { basis: b.basis, note: b.note, ...MARK },
        status: st,
        rtConf: "상",
        evidence: { doc: b.doc, name: b.name, quote: b.quote },
        provenance: PROV,
      });
      count.edge++;
    }

    const sub = fnId.get(t.fn);
    if (!sub) throw new Error(`${t.label}: 기능 분류 미정의(${t.fn})`);
    await putEdge({
      rel: "기능분류",
      from: taskId,
      to: sub,
      fromSpace: "work",
      fromType: "Task",
      toSpace: "concept",
      toType: "Function",
      props: { ...MARK },
      status: st,
      provenance: PROV,
    });
    count.edge++;
  }

  // ⑤ 업무 간 관계 — 선행·협업
  for (const p of data.precedes) {
    await putEdge({
      rel: "선행",
      from: p.from,
      to: p.to,
      fromSpace: "work",
      fromType: "Task",
      toSpace: "work",
      toType: "Task",
      props: { note: p.note, ...MARK },
      status: "candidate",
      provenance: PROV,
    });
    count.edge++;
  }
  for (const c of data.collabs) {
    await putEdge({
      rel: "협업",
      from: c.a,
      to: c.b,
      fromSpace: "work",
      fromType: "Task",
      toSpace: "work",
      toType: "Task",
      props: { note: c.note, ...MARK },
      status: "candidate",
      provenance: PROV,
    });
    count.edge++;
  }

  // ⑥ 보드 — 게이트 통과본 + 렌더캐시(SVG·모션)
  const coll = mongoose.connection.db!.collection(collectionName("work100Boards"));
  let renderFail = 0;
  for (const [taskId, b] of boards) {
    let svg: string | null = null;
    let motionSvg: string | null = null;
    try {
      svg = render(b.board, "render");
      motionSvg = normalizeMotion(render(b.board, "motion"));
    } catch (e) {
      renderFail++;
      console.log(`  ✗ 렌더 실패(보드 JSON만 저장): ${taskId} — ${String(e).slice(0, 120)}`);
    }
    await coll.updateOne(
      { taskId },
      {
        $set: {
          taskId,
          board: b.board,
          refsAnchors: b.refsAnchors,
          audit: { score: b.score ?? null },
          status: "promoted",
          sample: true,
          ...(svg ? { svg, motionSvg, renderCachedAt: new Date() } : {}),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    count.board++;
  }

  // ⑦ 근거 사규 실존 확인 — 없으면 '원문 보기'가 404가 된다(적재는 정상)
  const titles = [...new Set(data.tasks.flatMap((t) => [t.ownership.evidence.doc, ...t.approval.map((a) => a.evidence.doc), ...t.basis.map((b) => b.doc)]))];
  const found = await RagRegulationModel.find({ title: { $in: titles } }, { title: 1 }).lean<{ title: string }[]>();
  const missing = titles.filter((x) => !found.some((f) => f.title === x));

  console.log(
    `\n[대사] 노드 ${count.node} · 엣지 ${count.edge} · 보드 ${count.board}` +
      `${renderFail ? ` (렌더 실패 ${renderFail} — node ${BOARD_CLI} 실행 환경 확인)` : ""}`,
  );
  if (missing.length) {
    console.log(`[안내] 근거 사규 ${missing.length}건이 DB에 없습니다 — 업무탐색 패널의 '원문 보기'만 동작하지 않습니다(3D·보드는 정상).`);
    console.log(`       ${missing.join(" · ")}`);
    console.log(`       샘플 사규 제목이 다르면 ${path.relative(ROOT, DATA_FILE)} 의 doc 값을 맞추고 다시 실행하세요.`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
