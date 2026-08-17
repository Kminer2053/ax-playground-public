import { Schema, model, models, type InferSchemaType } from "mongoose";

/** AI 리터러시 서바이벌 결과 랭킹. (P3) */
const QuizRankingSchema = new Schema({
  nickname: { type: String, required: true, maxlength: 24 },
  score: { type: Number, required: true, min: 0 },
  comboMax: { type: Number, required: true, min: 0, default: 0 },
  playedAt: { type: Date, default: Date.now },
});

// 랭킹 정렬: 점수↓ → 최대콤보↓ → 먼저 달성한 순.
QuizRankingSchema.index({ score: -1, comboMax: -1, playedAt: 1 });

export type QuizRankingDoc = InferSchemaType<typeof QuizRankingSchema>;
export const QuizRankingModel = models.QuizRanking ?? model("QuizRanking", QuizRankingSchema);
