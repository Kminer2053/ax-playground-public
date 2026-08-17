// 일회성: 정제된 AI 리터러시 퀴즈 세트를 QuizPool(quizpools)에 추가 삽입.
// 사용: cd ax-portal && node scripts/seed-quiz.mjs <json경로>
import mongoose from "mongoose";
import { readFileSync } from "node:fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const m = envText.match(/^MONGODB_URI=(.+)$/m);
if (!m) { console.error("MONGODB_URI not found in .env.local"); process.exit(1); }
const uri = m[1].trim().replace(/^["']|["']$/g, "");

const path = process.argv[2] || new URL("./quiz-seed-data.json", import.meta.url).pathname;
const data = JSON.parse(readFileSync(path, "utf8"));
const valid = data.filter(
  (q) =>
    q.question &&
    Array.isArray(q.choices) && q.choices.length >= 2 &&
    Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.choices.length,
);
console.log(`로드 ${data.length} · 유효 ${valid.length}`);
if (valid.length !== data.length) { console.error("유효성 실패 항목 존재 — 중단"); process.exit(1); }

const Quiz = mongoose.model(
  "QuizPool",
  new mongoose.Schema(
    { question: String, choices: [String], answerIndex: Number, explanation: String, category: String, difficulty: String },
    { timestamps: { createdAt: true, updatedAt: false } },
  ),
);

await mongoose.connect(uri);
const before = await Quiz.countDocuments();
const res = await Quiz.insertMany(valid, { ordered: false });
const after = await Quiz.countDocuments();
console.log(`삽입 ${res.length}건 · 이전 ${before} → 현재 ${after}`);
await mongoose.disconnect();
