import { PanelCsAnswer } from "@/components/panels/desktop/PanelCsAnswer";
import { recordUsage } from "@/lib/usage";

export const metadata = { title: "AI 민원답변 — AX Playground" };
export const dynamic = "force-dynamic";

export default function CsAnswerPage() {
  recordUsage("cs", "enter");
  return <PanelCsAnswer />;
}
