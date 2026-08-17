import { PanelMagazine } from "@/components/panels/desktop/PanelMagazine";
import { recordUsage } from "@/lib/usage";

export const metadata = { title: "AI 리서치매거진 — AX Playground" };
export const dynamic = "force-dynamic";

export default function MagazinePage() {
  recordUsage("magazine", "enter"); // 정적 패널 — 진입만 계측(실행 이벤트 없음)
  return <PanelMagazine />;
}
