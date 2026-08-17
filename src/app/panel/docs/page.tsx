import { PanelDocs } from "@/components/panels/desktop/PanelDocs";
import { recordUsage } from "@/lib/usage";

export const metadata = { title: "AI 문서작성 — AX Playground" };
export const dynamic = "force-dynamic";

export default function DocsPage() {
  recordUsage("docs", "enter");
  return <PanelDocs />;
}
