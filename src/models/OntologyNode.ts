import { Schema, model, models, type InferSchemaType } from "mongoose";
import { collectionName } from "@/lib/collections";
import { STATUS } from "@/lib/ontology-manifest";

/**
 * 업무100 온톨로지 노드 — work(Task)·org(Dept·Position).
 * corpus(RegDoc·Article·ExtLaw)는 reference_only라 노드로 저장하지 않는다(엣지 anchor로만).
 *
 * id는 불변 슬러그(makeSlug). 개명은 label/alt만. 매니페스트 검증기(ontology-manifest.ts)를
 * 통과한 값만 저장하는 것이 규약 — 스키마는 형태만 보장하고, 화이트리스트는 검증기가 강제한다.
 */
const ProvenanceSchema = new Schema(
  { method: { type: String, enum: ["rule", "llm", "human"] }, model: { type: String }, at: { type: String } },
  { _id: false },
);

const OntologyNodeSchema = new Schema(
  {
    id: { type: String, required: true, unique: true }, // 불변 슬러그(예: dept:경영지원처)
    space: { type: String, required: true }, // work | org
    type: { type: String, required: true }, // Task | Dept | Position
    label: { type: String, required: true }, // prefLabel
    alt: { type: [String], default: [] }, // altLabel(별칭 마이닝 수용처)
    props: { type: Schema.Types.Mixed, default: {} }, // 타입별 속성(deptPath·kind·desc·boardId 등)
    status: { type: String, enum: STATUS as unknown as string[], default: "candidate" },
    provenance: { type: ProvenanceSchema },
    stale: { type: Schema.Types.Mixed, default: null }, // { since, reason } | null
  },
  { timestamps: true },
);

OntologyNodeSchema.index({ space: 1, type: 1 });
OntologyNodeSchema.index({ status: 1 });

export type OntologyNodeDoc = InferSchemaType<typeof OntologyNodeSchema>;
export const OntologyNodeModel =
  models.OntologyNode ?? model("OntologyNode", OntologyNodeSchema, collectionName("ontologyNodes"));
