import { Schema, model, models, type InferSchemaType, Types } from "mongoose";

const QuizLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "User" },
    quizId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "QuizPool" },
    isCorrect: { type: Boolean, required: true },
    quizDate: { type: String, required: true, index: true }, // YYYY-MM-DD (KST 기준은 API에서 맞춤)
    answeredAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

QuizLogSchema.index({ userId: 1, quizDate: 1 }, { unique: true });

export type QuizLogDoc = InferSchemaType<typeof QuizLogSchema> & {
  userId: Types.ObjectId;
  quizId: Types.ObjectId;
};
export const QuizLogModel = models.QuizLog ?? model("QuizLog", QuizLogSchema);

