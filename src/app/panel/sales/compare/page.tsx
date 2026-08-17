import { PanelSalesUpload } from "@/components/panels/desktop/PanelSalesUpload";

export const dynamic = "force-dynamic";

/** 편의점 매출 비교분석 — kr-sales 도입(엑셀 업로드 → 브라우저 분석 + AI 진단). */
export default function SalesComparePage() {
  return <PanelSalesUpload />;
}
