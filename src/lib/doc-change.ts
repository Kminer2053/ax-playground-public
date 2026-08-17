/**
 * 문서 내용이 바뀐 뒤 **반드시 따라와야 하는 후처리** — 표 태깅 → 근거 영향 판정 → 상태 집계.
 *
 * 경로마다 따로 챙기면 반드시 빠진다. 실제로 수동 CRUD(`/api/admin/regulations`)는
 * `updateGraphForDoc`만 부르고 나머지를 전부 빠뜨리고 있었다 — 기준데이터에서 조문을 고치거나
 * 사규를 삭제해도 어긋난 업무 근거가 격리되지 않았다(P2 안전장치가 그 경로에는 없던 셈).
 *
 * 임베딩·그래프(`updateGraphForDoc`)는 호출부마다 위계 부모 인자가 달라 여기 넣지 않는다.
 * 그 다음 단계부터가 이 함수의 몫이다.
 */
import { retagAndGlossDoc } from "@/lib/regulations-table-retag";
import { analyzeOntologyImpact, summarizeImpact, type ImpactResult } from "@/lib/ontology-impact";
import { refreshAssetStatus, pruneAssetStatus, type AssetStatus } from "@/lib/asset-status";

export type DocChangeResult = {
  tableRetag: Awaited<ReturnType<typeof retagAndGlossDoc>> | null;
  impact: ImpactResult | null;
  impactSummary: string;
  assets: AssetStatus | null;
};

/**
 * @param title  바뀐 문서 제목. 삭제·개명이면 **없어진 쪽** 제목을 `removedTitle`로 함께 넘긴다.
 * @param opts.removedTitle  사라진 제목 — 그 제목을 근거로 삼던 엣지는 doc-removed로 격리된다.
 * @param opts.retag  표 태깅 수행 여부(기본 true). 삭제만 하는 경우 false.
 */
export async function finalizeDocChange(
  title: string,
  opts: { removedTitle?: string; retag?: boolean } = {},
): Promise<DocChangeResult> {
  const out: DocChangeResult = { tableRetag: null, impact: null, impactSummary: "", assets: null };

  // 각 단계는 앞 단계 실패와 무관하게 진행한다 — 하나가 막혔다고 격리까지 멈추면 안 된다.
  if (title && opts.retag !== false) {
    try { out.tableRetag = await retagAndGlossDoc(title); }
    catch (e) { console.error("retagAndGlossDoc(finalize)", e); }
  }

  // 사라진 제목 먼저 — 개명이면 옛 제목 근거를 격리한 뒤 새 제목을 판정한다.
  if (opts.removedTitle) {
    try { await analyzeOntologyImpact(opts.removedTitle); }
    catch (e) { console.error("analyzeOntologyImpact(removed)", e); }
  }
  if (title) {
    try { out.impact = await analyzeOntologyImpact(title); out.impactSummary = summarizeImpact(out.impact); }
    catch (e) { console.error("analyzeOntologyImpact(finalize)", e); }
  }

  // 상태 집계는 영향 판정 뒤에 — 방금 세운 격리가 집계에 반영되도록.
  if (title) {
    try { out.assets = await refreshAssetStatus(title); }
    catch (e) { console.error("refreshAssetStatus(finalize)", e); }
  }
  if (opts.removedTitle) {
    try { await pruneAssetStatus(); }   // 없어진 문서의 상태 캐시 정리
    catch (e) { console.error("pruneAssetStatus(finalize)", e); }
  }

  return out;
}
