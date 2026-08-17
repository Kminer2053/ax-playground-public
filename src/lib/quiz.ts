/** 퀴즈 공용 유틸 — 보기 셔플 + pool 입력 검증. */
import { secureShuffle } from "@/lib/random";

export function shuffle<T>(arr: T[]): T[] {
  return secureShuffle(arr);
}

export type QuizInput = { question: string; choices: string[]; answerIndex: number; explanation: string };

/** pool 생성/수정 입력 검증. 실패 시 {error}, 성공 시 정제된 {value}. */
export function validateQuizInput(b: unknown): { error: string } | { value: QuizInput } {
  if (!b || typeof b !== "object") return { error: "JSON 본문이 필요합니다." };
  const o = b as Record<string, unknown>;
  const question = typeof o.question === "string" ? o.question.trim() : "";
  if (!question) return { error: "question(문제)이 필요합니다." };
  if (!Array.isArray(o.choices) || o.choices.length < 2 || o.choices.length > 6)
    return { error: "choices는 2~6개여야 합니다." };
  const choices = o.choices.map((c) => (typeof c === "string" ? c.trim() : ""));
  if (choices.some((c) => !c)) return { error: "모든 보기 내용이 필요합니다." };
  const answerIndex = o.answerIndex;
  if (typeof answerIndex !== "number" || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length)
    return { error: "answerIndex가 보기 범위를 벗어났습니다." };
  const explanation = typeof o.explanation === "string" ? o.explanation.trim() : "";
  return { value: { question, choices, answerIndex, explanation } };
}
