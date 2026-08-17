import OpenAI from "openai";
import { env } from "./env";
import { getPlaygroundConfig, getConfigSecrets } from "./playgroundConfig";
import { Semaphore, CapacityError } from "./semaphore";

/** OpenAI-compatible: normalize message.content (string or parts array). */
function openAiAssistantText(msg: OpenAI.Chat.ChatCompletionMessage | undefined): string {
  if (!msg) return "";
  const c = msg.content as string | OpenAI.Chat.ChatCompletionContentPart[] | null | undefined;
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part: OpenAI.Chat.ChatCompletionContentPart) => {
        if (part.type === "text") return part.text ?? "";
        return "";
      })
      .join("");
  }
  return "";
}

// baseURL+apiKey 조합별 클라이언트 캐시 (DB에서 서버를 바꿀 수 있으므로 싱글톤 대신 맵).
const _clients = new Map<string, OpenAI>();
function clientFor(baseURL: string, apiKey: string): OpenAI {
  const k = `${baseURL}|${apiKey}|${env.LLM_TIMEOUT_MS}|${env.LLM_MAX_RETRIES}`;
  let c = _clients.get(k);
  if (!c) {
    c = new OpenAI({ apiKey: apiKey || "ollama", baseURL, timeout: env.LLM_TIMEOUT_MS, maxRetries: env.LLM_MAX_RETRIES });
    _clients.set(k, c);
  }
  return c;
}

// 내부 LLM 서버 과부하 방지 — 전 패널 공통 전역 동시호출 상한(백프레셔). 단일 인스턴스 전제.
const _llmSem = new Semaphore(env.LLM_MAX_CONCURRENCY, env.LLM_MAX_QUEUE);

/** 동시 LLM 호출이 상한+대기열을 초과했을 때. 가드레일에서 503 차단으로 매핑한다. */
export class LlmBusyError extends Error {
  constructor() {
    super("AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.");
    this.name = "LlmBusyError";
  }
}
export function isLlmBusyError(e: unknown): e is LlmBusyError {
  return e instanceof LlmBusyError;
}

/** LLM 슬롯 획득 — 용량 초과면 LlmBusyError. 반환 함수로 반드시(finally) 해제. */
async function acquireLlmSlot(): Promise<() => void> {
  try {
    return await _llmSem.acquire();
  } catch (e) {
    if (e instanceof CapacityError) throw new LlmBusyError();
    throw e;
  }
}

function usesOpenAiCompatibleChat(): boolean {
  return Boolean(env.OPENAI_COMPATIBLE_BASE_URL && env.OPENAI_COMPATIBLE_MODEL);
}

/** 채팅 LLM 모드 — 내부망 로컬 LLM(OpenAI 호환) 전용. (env 기준 상태 배지용) */
export function getChatLlmMode(): "openai_compatible" | null {
  return usesOpenAiCompatibleChat() ? "openai_compatible" : null;
}

export function isChatLlmConfigured(): boolean {
  return getChatLlmMode() !== null;
}

export type LlmTarget = { baseURL: string; apiKey: string; model: string };

/**
 * feature(패널)별 LLM 타겟 해석 — DB 설정 우선, env 폴백.
 * featureModels[feature] > llmDefaultModel > env.OPENAI_COMPATIBLE_MODEL.
 */
export async function resolveLlmTarget(feature?: string): Promise<LlmTarget> {
  let baseURL = (env.OPENAI_COMPATIBLE_BASE_URL ?? "").trim();
  let model = (env.OPENAI_COMPATIBLE_MODEL ?? "").trim();
  let apiKey = (env.OPENAI_COMPATIBLE_API_KEY ?? "ollama").trim();
  try {
    const cfg = await getPlaygroundConfig();
    if (cfg.llmBaseUrl) baseURL = cfg.llmBaseUrl;
    const perFeature = feature ? cfg.featureModels?.[feature] : "";
    const picked = (perFeature || cfg.llmDefaultModel || model).trim();
    if (picked) model = picked;
    const secrets = await getConfigSecrets();
    if (secrets.llmApiKey) apiKey = secrets.llmApiKey;
  } catch {
    /* env 폴백 */
  }
  return { baseURL, apiKey, model };
}

/** 텍스트 또는 멀티모달(텍스트+이미지) content. 이미지 분석 등에서 사용. */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type LlmContent = string | LlmContentPart[];
export type LlmMessage = { role: "user" | "assistant"; content: LlmContent };

/** 멀티모달 메시지에서 텍스트 부분만 추출 (입력 가드 검사·로깅용). */
export function extractText(content: LlmContent): string {
  if (typeof content === "string") return content;
  return content
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

export type ChatLlmOptions = {
  maxTokens?: number;
  system?: string;
  temperature?: number;
  /** 패널/기능 키 — 기능별 모델 설정을 적용. */
  feature?: string;
  /** 명시적 타겟 override — 설정 테스트 등에서 사용(설정값 무시). */
  override?: Partial<LlmTarget>;
  /** 요청 취소 신호(클라이언트 disconnect 등) — 전달 시 중단되고 LLM 슬롯이 즉시 반납됨. */
  signal?: AbortSignal;
  /**
   * 구조화 출력 강제 — response_format: json_schema 로 전송해 모델이 JSON만 뱉도록 제약(constrained decoding).
   * 작은 양자화 모델(Ollama 등)에서 JSON이 깨지는 문제 방지. response_format 미지원 서버(400)면 자동으로 빼고 1회 재시도.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
};

async function resolveCall(options?: ChatLlmOptions): Promise<{ client: OpenAI; model: string }> {
  const target = await resolveLlmTarget(options?.feature);
  const baseURL = (options?.override?.baseURL || target.baseURL).trim();
  const apiKey = options?.override?.apiKey || target.apiKey;
  const model = (options?.override?.model || target.model).trim();
  if (!baseURL || !model) {
    throw new Error(
      "내부망 로컬 LLM(OpenAI 호환)이 설정되지 않았습니다. 관리자 → 설정에서 LLM 서버·모델을 지정하거나 .env.local을 설정하세요.",
    );
  }
  return { client: clientFor(baseURL, apiKey), model };
}

/**
 * 내부 로컬 LLM(OpenAI 호환) 호출 — 메시지 배열을 보내고 응답 텍스트를 반환합니다.
 * 외부 API는 사용하지 않습니다.
 */
export async function chatLlm(messages: LlmMessage[], options?: ChatLlmOptions): Promise<string> {
  const maxTokens = options?.maxTokens ?? 1024;
  const { client, model } = await resolveCall(options);
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (options?.system) {
    openaiMessages.push({ role: "system", content: options.system });
  }
  for (const m of messages) {
    openaiMessages.push({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam);
  }
  const temperature = options?.temperature ?? 0.3;
  const base: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: openaiMessages,
    max_tokens: maxTokens,
    temperature,
  };
  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = options?.jsonSchema
    ? { ...base, response_format: { type: "json_schema", json_schema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema } } }
    : base;
  const release = await acquireLlmSlot();
  try {
    try {
      const res = await client.chat.completions.create(params, { signal: options?.signal });
      const text = openAiAssistantText(res.choices[0]?.message);
      // 무음 강등 감지: json_schema를 400 없이 '조용히 무시'하는 서버는 비JSON 텍스트를 돌려준다.
      // 여기서 잡지 않으면 소비처 파서가 조용히 폴백해 형식 결함이 은폐된다(그래프 재적재 실측 사례).
      if (options?.jsonSchema && text.trim() && !/[{[]/.test(text)) {
        noteJsonFallback(model, options.jsonSchema.name, "non_json_response");
      }
      return text;
    } catch (e) {
      // response_format(구조화 출력)을 붙인 호출이 실패하면 상태코드와 무관하게 스키마를 빼고 1회 재시도(graceful).
      // 미지원 서버는 400을 주지만, 스키마 요청만 별도 풀로 보내 413/용량초과로 거부하는 서버도 있다(featherless 실측) —
      // 형식 보장 없이라도 답을 받는 편이 기능 전체가 죽는 것보다 낫다. 단 '조용히'는 금지(로그·카운터로 가시화).
      if (params !== base && e instanceof OpenAI.APIError) {
        noteJsonFallback(model, options?.jsonSchema?.name ?? "?", `http_${e.status ?? "err"}_retry_without_schema`);
        const res = await client.chat.completions.create(base, { signal: options?.signal });
        return openAiAssistantText(res.choices[0]?.message);
      }
      throw e;
    }
  } finally {
    release();
  }
}

// ── 구조화 출력 폴백 계측 — 관리자/진단에서 조회 가능(프로세스 생명주기 카운터) ──
const _jsonFallbacks = new Map<string, number>();
function noteJsonFallback(model: string, schemaName: string, kind: string): void {
  const key = `${model}|${schemaName}|${kind}`;
  _jsonFallbacks.set(key, (_jsonFallbacks.get(key) ?? 0) + 1);
  console.warn(`[llm] 구조화 출력 폴백(${kind}) — model=${model} schema=${schemaName} 누적=${_jsonFallbacks.get(key)}. 서버 json_schema 지원을 확인하세요.`);
}
/** 구조화 출력 폴백 누적 현황 — {"model|schema|kind": count} */
export function getJsonFallbackStats(): Record<string, number> {
  return Object.fromEntries(_jsonFallbacks);
}

/** Stream text deltas from the internal local LLM (OpenAI-compatible). */
export async function* streamChatLlm(
  messages: LlmMessage[],
  options?: ChatLlmOptions,
): AsyncGenerator<string, void, unknown> {
  const maxTokens = options?.maxTokens ?? 1024;
  const { client, model } = await resolveCall(options);
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (options?.system) {
    openaiMessages.push({ role: "system", content: options.system });
  }
  for (const m of messages) {
    openaiMessages.push({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam);
  }
  const temperature = options?.temperature ?? 0.3;
  const release = await acquireLlmSlot();
  try {
    const llmStream = await client.chat.completions.create(
      {
        model,
        messages: openaiMessages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
      },
      { signal: options?.signal },
    );
    for await (const part of llmStream) {
      const delta = part.choices[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) yield delta;
    }
  } finally {
    release();
  }
}

/**
 * 한 줄 사용자 메시지에 대한 응답 (간단 호출용)
 */
export async function askLlm(userMessage: string, systemPrompt?: string): Promise<string> {
  return chatLlm([{ role: "user", content: userMessage }], { system: systemPrompt });
}
