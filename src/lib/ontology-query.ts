/**
 * 온톨로지 런타임 조회 — 업무 관점 3형 질의.
 * 기본(런타임 불변식): **promoted && !stale 엣지만 소비**(관리자 결재본만 노출).
 * opts.all=true: candidate/validated 포함 전체 조회(업무탐색 UI가 상태 배지와 함께 노출) — 결재 전 검토용.
 * 지식검색/업무탐색 라우팅이 공용으로 사용. 회수·rerank와 독립(관계형 답변 전용).
 */
import { OntologyNodeModel } from "@/models/OntologyNode";
import { OntologyEdgeModel } from "@/models/OntologyEdge";

export type QueryOpts = { all?: boolean };
/**
 * 엣지 상태 필터 — 기본 promoted&!stale, all이면 상태 무관(stale만 제외).
 *
 * `stale`은 사유를 담은 객체(`{ reason, since }`)라 `$ne: true`로는 걸러지지 않는다.
 * `{ stale: null }`은 "null이거나 필드 없음"만 통과시키므로 값이 있으면 무조건 격리된다
 * — 승격 게이트(canPromoteEdge)의 truthy 판정과도 이제 같은 기준이다.
 */
export const NOT_STALE = { stale: null } as const;
const edgeFilter = (all?: boolean) => (all ? { ...NOT_STALE } : { status: "promoted", ...NOT_STALE });
const nodeFilter = (all?: boolean) => (all ? {} : { status: "promoted" });

export type Limit = { min: number | null; max: number | null; text: string } | null;

export type TaskNode = { id: string; label: string; dept?: string; desc?: string; status?: string };
export type Ownership = { dept: string; deptLabel?: string; duties: string[]; status?: string; evidence?: { doc?: string; name?: string; quote?: string } };
export type Approval = { position: string; limit: Limit; note?: string; status?: string; evidence?: { doc?: string; name?: string; quote?: string } };
export type Basis = { doc: string; name: string; basis?: string; note?: string; external?: boolean; status?: string; method?: string; evidence?: { quote?: string } };

/** 업무명(부분 일치) → Task 후보. 정확 라벨 우선, 없으면 부분 일치. */
export async function resolveTask(nameOrId: string, opts: QueryOpts = {}): Promise<TaskNode[]> {
  const nf = nodeFilter(opts.all);
  if (nameOrId.startsWith("task:")) {
    const n = await OntologyNodeModel.findOne({ id: nameOrId, type: "Task", ...nf }).lean<RawNode>();
    return n ? [toTask(n)] : [];
  }
  const exact = await OntologyNodeModel.find({ type: "Task", label: nameOrId, ...nf }).lean<RawNode[]>();
  if (exact.length) return exact.map(toTask);
  const rx = new RegExp(nameOrId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const part = await OntologyNodeModel.find({ type: "Task", label: rx, ...nf }).limit(8).lean<RawNode[]>();
  return part.map(toTask);
}

type RawNode = { id: string; label: string; status?: string; props?: { dept?: string; desc?: string } };
const toTask = (n: RawNode): TaskNode => ({ id: n.id, label: n.label, dept: n.props?.dept, desc: n.props?.desc, status: n.status });

/** ① 소관 — 이 업무는 어느 부서 소관인가. 분장업무마다 엣지 1건이므로 부서 단위로 집계(근거 분장은 duties에 누적). */
export async function taskOwnership(taskId: string, opts: QueryOpts = {}): Promise<Ownership[]> {
  const edges = await OntologyEdgeModel.find({ from: taskId, rel: "소관", ...edgeFilter(opts.all) }).lean<RawEdge[]>();
  const byDept = new Map<string, Ownership>();
  for (const e of edges) {
    const deptId = String(e.to);
    if (!byDept.has(deptId)) {
      const dept = await OntologyNodeModel.findOne({ id: deptId, ...nodeFilter(opts.all) }).lean<RawNode>();
      byDept.set(deptId, { dept: deptId, deptLabel: dept?.label, duties: [], status: e.status, evidence: pickEv(e) });
    }
    const quote = e.evidence?.quote;
    if (quote) byDept.get(deptId)!.duties.push(quote);
  }
  return [...byDept.values()];
}

/** ② 전결 — 이 업무는 누가 전결하며 한도는(경계 금액 포함). */
export async function taskApproval(taskId: string, opts: QueryOpts = {}): Promise<Approval[]> {
  const edges = await OntologyEdgeModel.find({ from: taskId, rel: "전결", ...edgeFilter(opts.all) }).lean<RawEdge[]>();
  const out: Approval[] = [];
  for (const e of edges) {
    const posId = String(e.to);
    const pos = await OntologyNodeModel.findOne({ id: posId, ...nodeFilter(opts.all) }).lean<RawNode>();
    out.push({
      position: pos?.label ?? posId.replace("position:", ""),
      limit: (e.props?.limit as Limit) ?? null,
      note: e.props?.positionRule as string | undefined,
      status: e.status,
      evidence: pickEv(e),
    });
  }
  return out;
}

/** ③ 업무근거 — 이 업무의 근거 조문은. basis(전결·절차·기준·서식)별. */
export async function taskBasis(taskId: string, opts: QueryOpts = {}): Promise<Basis[]> {
  const edges = await OntologyEdgeModel.find({ from: taskId, rel: "업무근거", ...edgeFilter(opts.all) }).lean<RawEdge[]>();
  return edges.map((e) => ({
    doc: e.evidence?.doc ?? "",
    name: e.evidence?.name ?? "",
    basis: e.props?.basis as string | undefined,
    note: e.props?.note as string | undefined,
    external: e.evidence?.external === true,
    status: e.status,
    method: e.provenance?.method,
    evidence: e.evidence?.quote ? { quote: e.evidence.quote } : undefined,
  }));
}

/** 역방향 — 부서 소관 업무 목록. */
export async function deptTasks(deptId: string, opts: QueryOpts = {}): Promise<TaskNode[]> {
  const edges = await OntologyEdgeModel.find({ to: deptId, rel: "소관", ...edgeFilter(opts.all) }).lean<RawEdge[]>();
  const ids = [...new Set(edges.map((e) => e.from))];
  const nodes = await OntologyNodeModel.find({ id: { $in: ids }, ...nodeFilter(opts.all) }).lean<RawNode[]>();
  return nodes.map(toTask);
}

/** 통합 프로파일 — 한 업무의 3형 답변을 한 번에(업무탐색 패널·지식검색 라우팅용). */
export async function taskProfile(taskId: string, opts: QueryOpts = {}) {
  const [ownership, approval, basis] = await Promise.all([
    taskOwnership(taskId, opts),
    taskApproval(taskId, opts),
    taskBasis(taskId, opts),
  ]);
  return { taskId, ownership, approval, basis };
}

type RawEdge = {
  from: string;
  to: unknown;
  status?: string;
  props?: Record<string, unknown>;
  provenance?: { method?: string };
  evidence?: { doc?: string; name?: string; quote?: string; external?: boolean } | null;
};
function pickEv(e: RawEdge) {
  if (!e.evidence?.doc) return undefined;
  return { doc: e.evidence.doc, name: e.evidence.name, quote: e.evidence.quote };
}
