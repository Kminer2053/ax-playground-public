import type { GuardCheckResult } from "../types";

/**
 * GR1-2 (M14): 프롬프트 인젝션 / 탈옥 시도 탐지 (llm-guard PromptInjection Scanner 동급).
 * 한국어·영어 인젝션 문구를 정규식으로 매칭하고, 가중 점수가 임계치를 넘으면 차단.
 * 점수제로 단일 키워드 오탐을 줄인다.
 */

type InjectionRule = {
  id: string;
  regex: RegExp;
  weight: number;
  desc: string;
};

const RULES: InjectionRule[] = [
  // 지시 무시·재정의
  {
    id: "ignore-instructions",
    regex: /(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|the)\s+(instruction|prompt|rule|context)/i,
    weight: 3,
    desc: "이전 지시 무시 시도",
  },
  {
    id: "ignore-instructions-ko",
    regex: /(이전|위|지금까지|앞의)\s*(의\s*)?(지시|지침|명령|규칙|프롬프트)[^\n]{0,6}(무시|잊어|무효|버려)/,
    weight: 3,
    desc: "이전 지시 무시 시도(한글)",
  },
  // 시스템 프롬프트 유출 유도
  {
    id: "reveal-system-prompt",
    regex: /(show|reveal|print|repeat|tell me|what (is|are))[^\n]{0,20}(system\s*prompt|your\s+(instruction|prompt|rule|guideline)|initial\s+prompt)/i,
    weight: 3,
    desc: "시스템 프롬프트 노출 유도",
  },
  {
    id: "reveal-system-prompt-ko",
    regex: /(시스템\s*프롬프트|너의?\s*(지침|지시|규칙|설정)|초기\s*프롬프트)[^\n]{0,12}(알려|보여|출력|공개|말해|뭐)/,
    weight: 3,
    desc: "시스템 프롬프트 노출 유도(한글)",
  },
  // 역할 변경·탈옥 페르소나
  {
    id: "jailbreak-persona",
    regex: /\b(DAN|do anything now|developer mode|jailbreak|unfiltered|without (any )?restriction)\b/i,
    weight: 3,
    desc: "탈옥 페르소나",
  },
  {
    id: "jailbreak-ko",
    regex: /(탈옥|제한\s*없이|필터\s*(없이|꺼|해제)|개발자\s*모드|검열\s*없)/,
    weight: 3,
    desc: "탈옥 시도(한글)",
  },
  {
    id: "act-as",
    regex: /(you are now|from now on,? you|act as (an?|the)|pretend (to be|you are)|role-?play as)/i,
    weight: 2,
    desc: "역할 변경 유도",
  },
  {
    id: "act-as-ko",
    regex: /(지금부터\s*너는|이제부터\s*너는|.{0,6}인\s*척\s*해|.{0,6}역할을?\s*해|.{0,6}처럼\s*행동)/,
    weight: 2,
    desc: "역할 변경 유도(한글)",
  },
  // 프롬프트 구분자/태그 주입
  {
    id: "delimiter-injection",
    regex: /(<\/?(system|assistant|user|s)>|\[\/?(INST|SYS)\]|<\|im_(start|end)\|>|###\s*(system|instruction))/i,
    weight: 2,
    desc: "구분자/특수태그 주입",
  },
];

export const INJECTION_BLOCK_THRESHOLD = 3;

export function scoreInjection(input: string): { score: number; hits: string[] } {
  let score = 0;
  const hits: string[] = [];
  for (const rule of RULES) {
    if (rule.regex.test(input)) {
      score += rule.weight;
      hits.push(rule.id);
    }
  }
  return { score, hits };
}

export function checkInjection(input: string, opts?: { threshold?: number }): GuardCheckResult {
  const threshold = opts?.threshold ?? INJECTION_BLOCK_THRESHOLD;
  const { score, hits } = scoreInjection(input);
  if (score >= threshold) {
    return {
      ok: false,
      block: {
        stage: "input",
        reason:
          "허용되지 않은 명령 패턴이 감지되어 요청이 차단되었습니다. 업무 관련 질문으로 다시 시도해 주세요.",
        ruleId: `M14-injection:${hits.join(",")}`,
        status: 422,
      },
    };
  }
  return { ok: true };
}
