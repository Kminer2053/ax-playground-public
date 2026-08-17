import { redirect } from "next/navigation";

// P10: 가드레일은 통합 관리자(/admin)의 탭으로 흡수됨.
export default function GuardrailRedirect() {
  redirect("/admin?tab=guardrails");
}
