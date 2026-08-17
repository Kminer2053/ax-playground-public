import { PanelAdReview } from "@/components/panels/desktop/PanelAdReview";
import { recordUsage } from "@/lib/usage";

export const metadata = { title: "AI 광고도안심의 — AX Playground" };
export const dynamic = "force-dynamic";

export default function AdReviewPage() {
  recordUsage("ad", "enter");
  return <PanelAdReview />;
}
