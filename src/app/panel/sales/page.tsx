import { PanelSalesHub } from "@/components/panels/desktop/PanelSalesHub";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** AI 매출분석 허브 — 편의점 매출 비교 / 업종별 매출트렌드 중 선택 진입. */
export default function SalesPanelPage() {
  recordUsage("sales", "enter"); // 하위(trend/compare)는 허브 경유이므로 이중집계 방지 위해 미계측
  return <PanelSalesHub />;
}
