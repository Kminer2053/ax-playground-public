/**
 * 적재 스모크 — "이 문서로 자주 묻는 질문이 검색에 걸리는가"를 적재 직후 자동 확인.
 *
 * 부서 제출 양식의 '예상 질문'을 문서 메타(metadata.smokeQuestions)로 받아, 커밋 후
 * 실제 회수 파이프라인(retrieveRagRegulationsForQa)으로 그 문서가 상위에 잡히는지 본다.
 * LLM 없이 회수 단계만 검사 — 수 초 안에 끝나고 폐쇄망에서 결정적으로 동작한다.
 * 청킹·검색이 조용히 깨졌을 때(표 행 유실 실사고) 가장 먼저 어긋나는 지표가 이것이다.
 */
import { retrieveRagRegulationsForQa } from "@/lib/regulations-retrieve";

export type SmokeResult = { q: string; hit: boolean; rank: number };

/** 상위 N(기본 5) 안에 대상 문서가 잡히면 통과. rank는 0부터, 미회수는 -1. */
export async function runSmokeQuestions(title: string, questions: string[], topN = 5): Promise<SmokeResult[]> {
  const out: SmokeResult[] = [];
  for (const raw of questions) {
    const q = raw.trim();
    if (!q) continue;
    try {
      const hits = await retrieveRagRegulationsForQa(q, Math.max(topN, 8));
      const rank = hits.findIndex((h) => String(h.title ?? "") === title);
      out.push({ q, hit: rank >= 0 && rank < topN, rank });
    } catch {
      out.push({ q, hit: false, rank: -1 });
    }
  }
  return out;
}

/** 줄 단위 입력 → 질문 배열(공백 줄 제거, 최대 10개). */
export function parseSmokeQuestions(text: string): string[] {
  return String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
}
