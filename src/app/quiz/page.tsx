import { QuizGame } from "@/components/quiz/QuizGame";
import { recordUsage } from "@/lib/usage";

export const metadata = { title: "AI 리터러시 서바이벌 — AX Playground" };
export const dynamic = "force-dynamic";

export default function QuizPage() {
  recordUsage("quiz", "enter");
  return <QuizGame />;
}
