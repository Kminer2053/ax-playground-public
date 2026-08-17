import { KnowledgeShell } from "@/components/panels/desktop/KnowledgeShell";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

/**
 * 지식/업무 패널 — 상단 토글로 [업무탐색(3D) | 지식검색] 통합(KnowledgeShell).
 * 기본 업무탐색. 지식검색은 기존 PanelKnowledge를 embedded로 유지.
 */
export default function LawPanelPage() {
  recordUsage("knowledge", "enter");
  return <KnowledgeShell />;
}
