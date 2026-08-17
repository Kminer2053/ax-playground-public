import { Schema, model, models, type InferSchemaType } from "mongoose";

const QuizPoolSchema = new Schema(
  {
    question: { type: String, required: true },
    choices: { type: [String], required: true },
    answerIndex: { type: Number, required: true },
    explanation: { type: String, required: false },
    /** 분류용 메타(선택) — 대량 출제 세트 관리·필터용. 게임 출제 로직에는 미사용. */
    category: { type: String, required: false },
    difficulty: { type: String, required: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type QuizPoolDoc = InferSchemaType<typeof QuizPoolSchema>;
export const QuizPoolModel = models.QuizPool ?? model("QuizPool", QuizPoolSchema);

