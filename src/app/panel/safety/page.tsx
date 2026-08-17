import { PanelSafety } from "@/components/panels/desktop/PanelSafety";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

export default function SafetyPanelPage() {
  recordUsage("safety", "enter");
  return <PanelSafety />;
}
