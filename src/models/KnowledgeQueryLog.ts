import { Schema, model, models, deleteModel, type InferSchemaType } from "mongoose";

/** 지식검색 질의 텔레메트리 — 검색 신호·경로·인용을 질의 단위로 축적.
 *  용도: ① 3분기 거절 임계 캘리브레이션(점수 분포) ② 자동피드백 루프(별칭 후보·회귀 문항 발굴)
 *  ③ 스테이지별 상태 관찰(조용한 강등 감지). 가드레일 감사로그(auditlogs)와 별개 — 보안 감사가 아닌 품질 텔레메트리. */
const KnowledgeQueryLogSchema = new Schema(
  {
    q: { type: String, required: true },              // 질의 원문
    mode: { type: String, default: "fast" },          // fast | deep
    path: { type: String, default: "llm", enum: ["llm", "extractive", "refused", "empty"] }, // 응답 경로
    signals: {
      top1: { type: Number, default: null },          // 재랭크 1위 종합점수
      top2: { type: Number, default: null },
      gap: { type: Number, default: null },           // top1 - top2 (특정성)
      vecTop: { type: Number, default: null },        // 벡터 원시 코사인 최고값(절대 신호)
      strongHits: { type: Number, default: 0 },       // 강한 키워드 매칭 문서 수
      textHits: { type: Number, default: 0 },         // $text 회수 건수
    },
    citedTitles: { type: [String], default: [] },     // 근거로 조립된 문서 제목들
    counts: { text: Number, vec: Number, graph: Number }, // 채널별 기여
    gate: {                                            // 인용 게이트 결과(P1-3)
      checked: { type: Boolean, default: false },
      unknownTitles: { type: [String], default: [] }, // 근거 밖 규정명 인용
      wrongArticles: { type: [String], default: [] }, // 규정은 맞으나 없는 조문 인용
      retried: { type: Boolean, default: false },
      refetched: { type: [String], default: [] },     // 인용게이트 재회수로 근거에 추가된 문서(회수 누락 신호)
    },
    stages: { type: [{ s: String, ms: Number, n: Number, _id: false }], default: [] }, // 스테이지 소요·건수(budget-trim 포함)
    retry: {                                           // 연성밴드 결정적 재회수(D) — 별칭 마이닝 원천
      attempted: { type: Boolean, default: false },
      adopted: { type: Boolean, default: false },     // 재회수 결과 채택 여부(vecTop 개선 시만)
      normalizedQ: { type: String, default: "" },     // 정규화 질의(별칭 치환·조사 제거)
      vecTopBefore: { type: Number, default: null },
      vecTopAfter: { type: Number, default: null },
    },
    latencyMs: { type: Number, default: 0 },
    day: { type: String, required: true },            // YYYY-MM-DD(집계용)
  },
  { timestamps: true }
);

KnowledgeQueryLogSchema.index({ day: 1, path: 1 });
KnowledgeQueryLogSchema.index({ createdAt: -1 });

export type KnowledgeQueryLogDoc = InferSchemaType<typeof KnowledgeQueryLogSchema>;
// dev(HMR)에서 스키마 변경이 즉시 반영되도록 기존 모델을 폐기 후 재등록(신규 필드 저장 유실 방지 — GuardConfig와 동일 관례)
if (process.env.NODE_ENV !== "production" && models.KnowledgeQueryLog) deleteModel("KnowledgeQueryLog");
export const KnowledgeQueryLogModel =
  models.KnowledgeQueryLog ?? model("KnowledgeQueryLog", KnowledgeQueryLogSchema);
