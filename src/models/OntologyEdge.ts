import { Schema, model, models, type InferSchemaType } from "mongoose";
import { collectionName } from "@/lib/collections";
import { STATUS, RTCONF } from "@/lib/ontology-manifest";

/**
 * 업무100 온톨로지 엣지 — 부서상하·선행·협업·소관·전결·업무근거.
 * from은 항상 노드 id. to는 노드 id(work/org) 또는 corpus 앵커 객체(업무근거).
 * fromSpace/fromType/toSpace/toType는 질의·검증용 비정규화 필드.
 * edgeKey는 (from,rel,to,evidence.doc,name,rowHash)의 결정적 직렬화 — 업서트 유일키.
 */
const EvidenceSchema = new Schema(
  {
    doc: { type: String }, // rag_regulation.title
    name: { type: String }, // articles[].name
    srcHash: { type: String }, // 24hex(판 드리프트 감지)
    rowHash: { type: String }, // 12hex(별표 행 완충)
    rowText: { type: String }, // 판정용 원문 행. quote는 사람이 읽는 인용이라 파싱 잡음이 섞일 수 있어 분리한다
    quote: { type: String }, // fullText 원문 절취
    external: { type: Boolean }, // 명칭 미식별 외부 참조(promoted 불가)
  },
  { _id: false },
);
const ProvenanceSchema = new Schema(
  { method: { type: String, enum: ["rule", "llm", "human"] }, model: { type: String }, at: { type: String } },
  { _id: false },
);
/** 격리 직전의 근거 스냅샷 — 재검토 화면의 '변경 전' 열. 지금 원문과 나란히 놓고 판단한다. */
const StaleFromSchema = new Schema(
  { name: { type: String }, srcHash: { type: String }, rowHash: { type: String }, quote: { type: String }, at: { type: Date } },
  { _id: false },
);

const OntologyEdgeSchema = new Schema(
  {
    edgeKey: { type: String, required: true, unique: true },
    rel: { type: String, required: true }, // 부서상하|선행|협업|소관|전결|업무근거
    from: { type: String, required: true }, // 노드 id
    to: { type: Schema.Types.Mixed, required: true }, // 노드 id(string) | corpus 앵커(object)
    fromSpace: { type: String, required: true },
    fromType: { type: String, required: true },
    toSpace: { type: String, required: true }, // org|work|corpus
    toType: { type: String, required: true }, // Dept|Position|Task|RegDoc|Article|ExtLaw
    props: { type: Schema.Types.Mixed, default: {} }, // basis·limit·condition·positionRule·note 등
    status: { type: String, enum: STATUS as unknown as string[], default: "candidate" },
    rtConf: { type: String, enum: RTCONF as unknown as string[] },
    evidence: { type: EvidenceSchema },
    stale: { type: Schema.Types.Mixed, default: null }, // { since, reason } | null — 값이 있으면 런타임에서 격리
    // 격리 직전의 근거 값. 관리자가 "무엇이 어떻게 바뀌었는지" 비교하려면 변경 전 값이 남아 있어야 한다.
    staleFrom: { type: StaleFromSchema },
    provenance: { type: ProvenanceSchema },
  },
  { timestamps: true },
);

OntologyEdgeSchema.index({ rel: 1, status: 1 });
OntologyEdgeSchema.index({ from: 1 });
OntologyEdgeSchema.index({ toSpace: 1, toType: 1 });
OntologyEdgeSchema.index({ "evidence.doc": 1 }); // 문서 삭제 훅 stale 처리용

export type OntologyEdgeDoc = InferSchemaType<typeof OntologyEdgeSchema>;
export const OntologyEdgeModel =
  models.OntologyEdge ?? model("OntologyEdge", OntologyEdgeSchema, collectionName("ontologyEdges"));
