import { chatLlm, streamChatLlm, extractText, isLlmBusyError, type LlmMessage } from "@/lib/llm";
import { getPlaygroundConfig } from "@/lib/playgroundConfig";
import { getGuardConfig, type ResolvedGuardConfig } from "./config";
import { checkInjection } from "./input/injection";
import { checkLength } from "./input/length";
import { checkInputPii } from "./input/pii";
import { checkRateLimit } from "./input/ratelimit";
import { buildSystemPrompt } from "./model/system-prompt";
import { recordAudit } from "./output/audit";
import { maskOutputPii } from "./output/pii-mask";
import { scanOutputSecrets } from "./output/secrets";
import {
  GuardBlockedError,
  type GuardBlock,
  type GuardContext,
} from "./types";

export * from "./types";
export { buildSystemPrompt } from "./model/system-prompt";
export { getGuardConfig, invalidateGuardConfigCache, DEFAULT_GUARD_CONFIG, type ResolvedGuardConfig } from "./config";

export type GuardChatOptions = {
  messages: LlmMessage[];
  ctx: GuardContext;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * 입력 가드(length/injection/PII) 검사 대상 텍스트.
   * 미지정 시 user 메시지 전체를 검사. RAG 컨텍스트 등 신뢰 가능한 큰 텍스트를
   * messages에 포함할 때, 실제 사용자 입력(질문)만 여기에 지정하면 그 부분만 검사한다.
   */
  guardInput?: string;
  /** 구조화 출력(JSON 스키마) 강제 — JSON 응답이 필요한 호출용. 미지원 서버는 자동 폴백(llm.ts). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
};

/**
 * user 역할 메시지만 이어붙여 입력 검사용 텍스트로 만든다.
 * system 프롬프트(우리가 통제하는 신뢰 입력)는 검사 대상에서 제외 — 보안 프리앰블의
 * "탈옥 거부" 등 문구가 인젝션 룰에 자기-오탐되는 것을 방지.
 */
function joinUserText(messages: LlmMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => extractText(m.content))
    .join("\n");
}

async function runInputGuards(
  input: string,
  ctx: GuardContext,
  config: ResolvedGuardConfig,
): Promise<GuardBlock | null> {
  if (config.enableLength) {
    const len = checkLength(input, { maxChars: config.maxInputChars });
    if (!len.ok) return len.block;
  }

  if (config.enableRateLimit) {
    const rate = await checkRateLimit(ctx, {
      perWindow: config.rateLimitPerWindow,
      windowSec: config.rateLimitWindowSec,
    });
    if (!rate.ok) return rate.block;
  }

  // GR1-2 (M14): 프롬프트 인젝션 / 탈옥 시도 차단.
  if (config.enableInjection) {
    const injection = checkInjection(input, { threshold: config.injectionThreshold });
    if (!injection.ok) return injection.block;
  }

  // GR1-3 (M13): 고위험 PII 입력 차단.
  if (config.enablePii) {
    const pii = checkInputPii(input, { blockTypes: new Set(config.blockOnInputPii) });
    if (!pii.ok) return pii.block;
  }

  return null;
}

/** 관리자 DB 설정의 마스킹 IP 문자열(콤마 구분) → 배열. */
function splitMaskIps(csv: string): string[] {
  return (csv || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** 출력 가드 결과: 차단(block) 또는 정제된 텍스트(text)+마스킹 타입. */
type OutputGuardResult =
  | { block: GuardBlock }
  | { block: null; text: string; maskedTypes: string[] };

function runOutputGuards(output: string, config: ResolvedGuardConfig): OutputGuardResult {
  let text = output;
  const maskedTypes: string[] = [];

  if (config.enableOutputSecrets) {
    // GR3-2 (M13): 악성코드 패턴이면 출력 자체를 차단. 추가 보호 IP(관리자 DB 설정)도 함께 마스킹.
    const secrets = scanOutputSecrets(text, splitMaskIps(config.maskExtraIps));
    if (secrets.malicious) {
      return {
        block: {
          stage: "output",
          reason: "응답에 위험한 명령 패턴이 포함되어 차단되었습니다.",
          ruleId: `M13-output-malicious:${secrets.malicious}`,
          status: 502,
        },
      };
    }
    // 자격증명·내부 IP 마스킹.
    text = secrets.text;
    maskedTypes.push(...secrets.maskedTypes);
  }

  if (config.enableOutputPiiMask) {
    // GR3-1 (M13): PII 마스킹.
    const piiResult = maskOutputPii(text);
    text = piiResult.text;
    maskedTypes.push(...new Set(piiResult.masked.map((m) => m.type)));
  }

  return { block: null, text, maskedTypes };
}

/** 스트리밍 청크용: 시크릿+PII 마스킹 적용 (악성 차단은 누적 버퍼에서 별도 판정). */
function sanitizeChunk(text: string, config: ResolvedGuardConfig): string {
  let t = text;
  if (config.enableOutputSecrets) t = scanOutputSecrets(t, splitMaskIps(config.maskExtraIps)).text;
  if (config.enableOutputPiiMask) t = maskOutputPii(t).text;
  return t;
}

/**
 * 가드레일이 적용된 채팅 호출 (비스트리밍).
 * 입력 검사 → LLM 호출 → 출력 검사 순서로 실행.
 * 차단 시 GuardBlockedError를 throw — 라우트에서 catch 후 block.status로 응답.
 */
export async function guardedChat(opts: GuardChatOptions): Promise<string> {
  const start = Date.now();
  const config = await getGuardConfig();
  const inputText = opts.guardInput ?? joinUserText(opts.messages);
  // GR2-1 (M15): 보안 프리앰블 + 패널 역할을 system에 강제 주입.
  // 단, 멀티모달(이미지) 호출에는 system 턴 자체를 주입하지 않는다 — gemma-4-e2b 등 작은 비전
  // 모델은 system 턴이 있으면 첨부 이미지를 "없다"고 무시한다(실측: system 주입 시 0/5, 제거 시 5/5.
  // 프리앰블 내용 무관 — 무관한 문장도 동일 실패. gemma 계열은 네이티브 system 역할이 없어 생기는 구조 문제).
  // 보안은 아래 입력/출력 가드가 그대로 적용되므로(다중 방어), 멀티모달에선 라우트 커스텀 지시(opts.system)만 전달.
  const multimodal = opts.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
  // 기관명은 관리자 설정(playground_config.orgName)에서 주입 — 미설정이면 프리앰블은 "우리 기관" 폴백.
  const { orgName } = await getPlaygroundConfig();
  const system = multimodal
    ? (opts.system && opts.system.trim() ? opts.system.trim() : undefined)
    : buildSystemPrompt(opts.ctx.panel, opts.system, { orgName });

  const inputBlock = await runInputGuards(inputText, opts.ctx, config);
  if (inputBlock) {
    if (config.enableAudit) {
      void recordAudit({
        ctx: opts.ctx,
        outcome: "blocked",
        stage: inputBlock.stage,
        ruleId: inputBlock.ruleId,
        inputText,
        latencyMs: Date.now() - start,
      });
    }
    throw new GuardBlockedError(inputBlock);
  }

  let raw: string;
  try {
    raw = await chatLlm(opts.messages, {
      system,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      feature: opts.ctx.panel,
      signal: opts.ctx.signal,
      jsonSchema: opts.jsonSchema,
    });
  } catch (e) {
    // 과부하(동시호출 상한 초과) — 모델 오류가 아니라 백프레셔 → 503 차단으로 매핑.
    if (isLlmBusyError(e)) {
      if (config.enableAudit) {
        void recordAudit({ ctx: opts.ctx, outcome: "blocked", stage: "model", ruleId: "llm-busy", inputText, latencyMs: Date.now() - start });
      }
      throw new GuardBlockedError({ stage: "model", reason: e.message, ruleId: "llm-busy", status: 503 });
    }
    // 입력은 통과했으나 LLM 호출 실패 — 모니터링에 error로 기록 후 에러 전파.
    if (config.enableAudit) {
      void recordAudit({
        ctx: opts.ctx,
        outcome: "error",
        stage: "model",
        ruleId: "model-error",
        inputText,
        outputText: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      });
    }
    throw e;
  }

  const out = runOutputGuards(raw, config);
  if (out.block) {
    if (config.enableAudit) {
      void recordAudit({
        ctx: opts.ctx,
        outcome: "blocked",
        stage: out.block.stage,
        ruleId: out.block.ruleId,
        inputText,
        outputText: raw,
        latencyMs: Date.now() - start,
      });
    }
    throw new GuardBlockedError(out.block);
  }

  // M09: 정상 응답 감사 기록.
  if (config.enableAudit) {
    void recordAudit({
      ctx: opts.ctx,
      outcome: "pass",
      inputText,
      outputText: out.text,
      maskedTypes: out.maskedTypes,
      latencyMs: Date.now() - start,
    });
  }
  return out.text;
}

/**
 * 가드레일이 적용된 스트리밍 호출.
 * 입력 검사 → 스트리밍(청크별 PII·시크릿 마스킹, 경계 보류) → 감사 로그.
 */
export async function* guardedStreamChat(
  opts: GuardChatOptions,
): AsyncGenerator<string, void, unknown> {
  const start = Date.now();
  const config = await getGuardConfig();
  const inputText = opts.guardInput ?? joinUserText(opts.messages);
  // GR2-1 (M15): 보안 프리앰블 + 패널 역할 주입 (기관명은 관리자 설정에서).
  const { orgName } = await getPlaygroundConfig();
  const system = buildSystemPrompt(opts.ctx.panel, opts.system, { orgName });

  const inputBlock = await runInputGuards(inputText, opts.ctx, config);
  if (inputBlock) {
    if (config.enableAudit) {
      void recordAudit({
        ctx: opts.ctx,
        outcome: "blocked",
        stage: inputBlock.stage,
        ruleId: inputBlock.ruleId,
        inputText,
        latencyMs: Date.now() - start,
      });
    }
    throw new GuardBlockedError(inputBlock);
  }

  // GR3-1: 스트리밍 출력도 PII 마스킹. PII가 청크 경계를 가로지를 수 있으므로
  // 안전 꼬리(SAFE_TAIL)만큼 버퍼에 남겨두고, 경계에 걸친 매칭은 다음 청크까지 보류.
  const SAFE_TAIL = 64;
  let buffer = "";
  let emitted = ""; // 감사 로그용 누적 출력(정제 후)

  const stream = streamChatLlm(opts.messages, {
    system,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    feature: opts.ctx.panel,
    signal: opts.ctx.signal,
  });

  try {
    for await (const chunk of stream) {
      buffer += chunk;
      if (buffer.length <= SAFE_TAIL) continue;

      let flushTo = buffer.length - SAFE_TAIL;
      const matches = maskOutputPii(buffer).masked;
      // 경계에 걸친(또는 경계 이후 시작하는) 매칭은 flush 지점을 그 앞으로 당겨 보류.
      for (const m of matches) {
        if (m.index + m.length > flushTo && m.index < flushTo) flushTo = m.index;
      }
      if (flushTo <= 0) continue;

      const head = buffer.slice(0, flushTo);
      buffer = buffer.slice(flushTo);
      const clean = sanitizeChunk(head, config);
      emitted += clean;
      yield clean;
    }

    // 잔여 버퍼 전체 정제 후 방출.
    if (buffer.length > 0) {
      const clean = sanitizeChunk(buffer, config);
      emitted += clean;
      yield clean;
    }
  } catch (e) {
    // 과부하(동시호출 상한 초과) — 백프레셔 → 503 차단으로 매핑.
    if (isLlmBusyError(e)) {
      if (config.enableAudit) {
        void recordAudit({ ctx: opts.ctx, outcome: "blocked", stage: "model", ruleId: "llm-busy", inputText, latencyMs: Date.now() - start });
      }
      throw new GuardBlockedError({ stage: "model", reason: e.message, ruleId: "llm-busy", status: 503 });
    }
    // 입력 통과 후 스트리밍 중 LLM 실패 — error로 기록 후 전파.
    if (config.enableAudit) {
      void recordAudit({
        ctx: opts.ctx,
        outcome: "error",
        stage: "model",
        ruleId: "model-error",
        inputText,
        outputText: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      });
    }
    throw e;
  }

  // M09: 스트림 완료 후 감사 기록.
  if (config.enableAudit) {
    void recordAudit({
      ctx: opts.ctx,
      outcome: "pass",
      inputText,
      outputText: emitted,
      latencyMs: Date.now() - start,
    });
  }
}

export { buildGuardContext, extractRequestMeta } from "./context";
