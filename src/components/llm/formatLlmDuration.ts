/** LLM 응답 지연(ms)을 사용자에게 보여줄 때 사용 */
export function formatLlmMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}초`;
}
