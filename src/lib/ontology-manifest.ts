/**
 * 업무100 온톨로지 매니페스트 — 로더 + 쓰기 시점 하드 검증기.
 *
 * `data/ontology/manifest.v0.json`(단일 기준)을 읽어, 노드·엣지 쓰기가
 * 공간·노드타입·공간쌍별 허용관계 화이트리스트와 불변식을 어기지 않는지 강제한다.
 * 매니페스트 밖 조합은 예외로 거부한다(ONTOLOGY.md 불변식 목록).
 *
 * 순수 판정 함수만 둔다(DB 접근 없음) — 시드 스크립트·적재 API·검토 큐가 공유.
 */
import manifest from "../../data/ontology/manifest.v0.json";

// ── 매니페스트 타입(느슨) ──────────────────────────────────────
type MetaEdge = {
  rel: string;
  from: [string, string[]];
  to: [string, string[]];
  props?: Record<string, unknown>;
  evidence?: "required" | "optional";
};
type SpaceDef = {
  label: string;
  reference_only?: boolean;
  node_types: Record<string, { closed_instances?: string[] }>;
};

const SPACES = manifest.spaces as unknown as Record<string, SpaceDef>;
const META_EDGES = manifest.meta_edges as unknown as MetaEdge[];
export const MANIFEST_VERSION = manifest.manifest_version as string;

export const STATUS = ["candidate", "validated", "promoted", "rejected"] as const;
export type OntologyStatus = (typeof STATUS)[number];
export const RTCONF = ["상", "중", "하"] as const;

/** 검증 위반 — 저장 거부의 원인. 메시지는 관리자·로그에 그대로 노출. */
export class OntologyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OntologyViolation";
  }
}

// ── ① 슬러그(node id) 생성 — 매니페스트 node_common_fields.id 규칙 단일 구현 ──
// 가운뎃점·슬래시·공백·쉼표 → '-' (NFKC 전: NFKC가 ㆍU+318D를 조합중성 U+119E로 바꿔 삭제시키므로) →
// NFKC → 괄호(및 내용) 제거 → 한글·영숫자·하이픈만 → 연속 하이픈 축약.
// 가운뎃점: ㆍ(U+318D)·․(U+2024)·‧(U+2027) + 실무 흔한 ·(U+00B7).
export function makeSlug(prefix: string, label: string): string {
  const body = label
    .replace(/[ㆍ․‧·]/g, "-") // 가운뎃점류 → 하이픈(NFKC 이전, 소실 방지)
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, "") // 괄호와 그 내용 제거
    .replace(/[/\s,]+/g, "-") // 슬래시·공백·쉼표 → 하이픈
    .replace(/[^0-9A-Za-z가-힣-]/g, "") // 허용 문자만
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!body) throw new OntologyViolation(`슬러그 생성 실패(빈 결과): "${label}"`);
  return `${prefix}:${body}`;
}

// ── ② 노드 쓰기 허용 판정 ─────────────────────────────────────
/** (space, type)이 매니페스트에 있고 reference_only가 아니면 통과. 위반 시 throw. */
export function assertNodeAllowed(space: string, type: string): void {
  const sp = SPACES[space];
  if (!sp) throw new OntologyViolation(`알 수 없는 공간: "${space}"`);
  if (sp.reference_only) throw new OntologyViolation(`reference_only 공간(${space})에는 노드를 만들 수 없습니다(앵커로만 참조)`);
  if (!sp.node_types[type]) throw new OntologyViolation(`공간 ${space}에 없는 노드타입: "${type}"`);
}

/** org:Position 라벨이 닫힌 목록 안에 있는지. */
export function assertPositionLabel(label: string): void {
  const closed = SPACES.org?.node_types?.Position?.closed_instances ?? [];
  if (!closed.includes(label)) {
    throw new OntologyViolation(`Position "${label}"은(는) 닫힌 직위 목록에 없습니다(${closed.join("·")})`);
  }
}

export function positionInstances(): string[] {
  return SPACES.org?.node_types?.Position?.closed_instances ?? [];
}

// ── ③ 엣지 쓰기 허용 판정 ─────────────────────────────────────
function findMetaEdge(fromSpace: string, fromType: string, rel: string, toSpace: string, toType: string): MetaEdge | null {
  return (
    META_EDGES.find(
      (m) =>
        m.rel === rel &&
        m.from[0] === fromSpace &&
        m.from[1].includes(fromType) &&
        m.to[0] === toSpace &&
        m.to[1].includes(toType),
    ) ?? null
  );
}

/** (from, rel, to) 조합이 meta_edge 화이트리스트에 있으면 통과. 위반 시 throw. */
export function assertEdgeAllowed(
  fromSpace: string,
  fromType: string,
  rel: string,
  toSpace: string,
  toType: string,
): void {
  if (!findMetaEdge(fromSpace, fromType, rel, toSpace, toType)) {
    throw new OntologyViolation(
      `허용되지 않은 관계: (${fromSpace}:${fromType}) ─${rel}→ (${toSpace}:${toType})`,
    );
  }
}

/** 이 관계가 evidence 필수인가. */
export function isEvidenceRequired(rel: string): boolean {
  return META_EDGES.some((m) => m.rel === rel && m.evidence === "required");
}

// ── ④ 협업 무방향 정규화 — from.id < to.id 사전순만 저장 허용 ──
/** 협업 엣지는 (from,to)를 사전순으로 정렬해 반환. 그 외 관계는 그대로. */
export function normalizeUndirected(rel: string, fromId: string, toId: string): { from: string; to: string } {
  if (rel === "협업" && fromId > toId) return { from: toId, to: fromId };
  return { from: fromId, to: toId };
}

// ── ⑤ 승격(promoted) 게이트 — 매니페스트 불변식 ─────────────────
type EdgeLike = {
  rel: string;
  status?: string;
  evidence?: { doc?: string; external?: boolean } | null;
  stale?: unknown;
};
/**
 * candidate/validated 엣지를 promoted로 올릴 수 있는지.
 * evidence required 미충족·external=true·stale은 거부.
 * (양단 노드 promoted 여부는 DB 조회가 필요하므로 호출부에서 별도 확인.)
 */
export function canPromoteEdge(edge: EdgeLike): { ok: boolean; reason?: string } {
  if (edge.stale) return { ok: false, reason: "stale 엣지는 승격 불가(재검토 큐에서 해소 후)" };
  if (isEvidenceRequired(edge.rel)) {
    if (!edge.evidence?.doc) return { ok: false, reason: `${edge.rel}은(는) evidence 없이 승격 불가` };
    if (edge.evidence.external) return { ok: false, reason: "evidence.external(명칭 미식별) 엣지는 승격 불가 — ExtLaw 앵커로 전환 필요" };
  }
  return { ok: true };
}

// ── ⑥ 엣지 자연키(unique) — 매니페스트 storage.unique_keys.edges 단일 구현 ──
// (from, rel, to, evidence.doc, evidence.name, evidence.rowHash). 별표 1행=엣지 1건 업서트 기준.
export type EdgeAnchor = { doc?: string; name?: string; srcHash?: string; law?: string; article?: string; cat?: string };
export function computeEdgeKey(
  from: string,
  rel: string,
  to: string | EdgeAnchor,
  evidence?: { doc?: string; name?: string; rowHash?: string } | null,
): string {
  const toKey = typeof to === "string" ? to : `${to.doc ?? to.law ?? ""}#${to.name ?? to.article ?? ""}`;
  const ev = evidence ?? {};
  return [from, rel, toKey, ev.doc ?? "", ev.name ?? "", ev.rowHash ?? ""].join("|");
}

/** 매니페스트 요약(대사 리포트·기동 로그용). */
export function manifestSummary(): { version: string; spaces: string[]; relations: string[] } {
  return {
    version: MANIFEST_VERSION,
    spaces: Object.keys(SPACES),
    relations: META_EDGES.map((m) => m.rel),
  };
}
