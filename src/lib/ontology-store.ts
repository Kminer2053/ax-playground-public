/**
 * 온톨로지 노드·엣지 저장 헬퍼 — 검증기(ontology-manifest)를 반드시 경유하는 upsert.
 * 시드 스크립트·생성 파이프라인·검토 큐가 공유한다. DB 연결은 호출부 책임(connectDb).
 */
import { OntologyNodeModel } from "@/models/OntologyNode";
import { OntologyEdgeModel } from "@/models/OntologyEdge";
import {
  makeSlug,
  assertNodeAllowed,
  assertPositionLabel,
  assertEdgeAllowed,
  isEvidenceRequired,
  normalizeUndirected,
  computeEdgeKey,
  OntologyViolation,
  type EdgeAnchor,
  type OntologyStatus,
} from "@/lib/ontology-manifest";

const SLUG_PREFIX: Record<string, string> = { Dept: "dept", Task: "task", Position: "position", Function: "fn" };

export type Provenance = { method: "rule" | "llm" | "human"; model?: string; at: string };
type NodeInput = {
  space: string;
  type: string;
  label: string;
  alt?: string[];
  props?: Record<string, unknown>;
  status?: OntologyStatus;
  provenance: Provenance;
  id?: string; // 명시 id(없으면 label에서 슬러그 생성)
};

/** 노드 upsert(검증기 경유). 반환: 노드 id. */
export async function putNode(input: NodeInput): Promise<string> {
  assertNodeAllowed(input.space, input.type);
  if (input.type === "Position") assertPositionLabel(input.label);
  const prefix = SLUG_PREFIX[input.type];
  if (!prefix) throw new OntologyViolation(`슬러그 접두 미정의 노드타입: ${input.type}`);
  const id = input.id ?? makeSlug(prefix, input.label);
  await OntologyNodeModel.findOneAndUpdate(
    { id },
    {
      $set: {
        id,
        space: input.space,
        type: input.type,
        label: input.label,
        alt: input.alt ?? [],
        props: input.props ?? {},
        status: input.status ?? "candidate",
        provenance: input.provenance,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return id;
}

type Evidence = { doc?: string; name?: string; srcHash?: string; rowHash?: string; quote?: string; external?: boolean };
type EdgeInput = {
  rel: string;
  from: string; // 노드 id
  to: string | EdgeAnchor; // 노드 id | corpus 앵커
  fromSpace: string;
  fromType: string;
  toSpace: string;
  toType: string;
  props?: Record<string, unknown>;
  status?: OntologyStatus;
  rtConf?: "상" | "중" | "하";
  evidence?: Evidence;
  provenance: Provenance;
};

/** 엣지 upsert(검증기 경유). 반환: edgeKey. */
export async function putEdge(input: EdgeInput): Promise<string> {
  assertEdgeAllowed(input.fromSpace, input.fromType, input.rel, input.toSpace, input.toType);
  if (isEvidenceRequired(input.rel) && !input.evidence?.doc) {
    throw new OntologyViolation(`${input.rel}은(는) evidence(doc) 필수입니다`);
  }
  // 협업 무방향 정규화(to가 노드 id일 때만 의미)
  let from = input.from;
  let to = input.to;
  if (typeof to === "string") {
    const norm = normalizeUndirected(input.rel, from, to);
    from = norm.from;
    to = norm.to;
  }
  const edgeKey = computeEdgeKey(from, input.rel, to, input.evidence);
  await OntologyEdgeModel.findOneAndUpdate(
    { edgeKey },
    {
      $set: {
        edgeKey,
        rel: input.rel,
        from,
        to,
        fromSpace: input.fromSpace,
        fromType: input.fromType,
        toSpace: input.toSpace,
        toType: input.toType,
        props: input.props ?? {},
        status: input.status ?? "candidate",
        rtConf: input.rtConf,
        evidence: input.evidence,
        provenance: input.provenance,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return edgeKey;
}
