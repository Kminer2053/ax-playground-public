import { env } from "./env";

const DEFAULT_OLLAMA_EMBED_MODEL = "nomic-embed-text";

/** Ollama `/api/embeddings` 입력 상한 — 시드 문자열 설계 시 이 값과 맞출 것 */
export const EMBEDDING_INPUT_MAX_CHARS = 8192;

function embeddingDims(): number {
  if (env.EMBEDDING_DIMENSIONS != null) return env.EMBEDDING_DIMENSIONS;
  return 768;
}

/** 사규 검색·시드에서 사용하는 임베딩 차원 (`EMBEDDING_DIMENSIONS` 또는 기본 768) */
export const EMBEDDING_DIMENSIONS = embeddingDims();

/** 표시용 — 시드/재임베딩 로그 등 */
export const EMBEDDING_MODEL = env.OLLAMA_EMBEDDING_MODEL ?? DEFAULT_OLLAMA_EMBED_MODEL;

/**
 * 텍스트 임베딩 — base URL 규약으로 프로토콜 자동 분기:
 *  - base 경로에 `/v1` 포함 → OpenAI 호환 (`POST {base}/embeddings`, `{model,input:[text]}` → `{data:[{embedding}]}`).
 *    예: 내부 BGE-M3 FastAPI `http://<AILLM>:8001/v1` (1024차원).
 *  - 그 외 → Ollama 네이티브 (`POST {base}/api/embeddings`, `{model,prompt}` → `{embedding}`).
 * 모델 미설정 또는 차원 불일치/오류 시 null(호출부는 graceful 처리).
 */
export async function getEmbedding(text: string, opts?: { model?: string; dims?: number; baseUrl?: string }): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const model = (opts?.model && opts.model.trim()) || env.OLLAMA_EMBEDDING_MODEL;
  if (!model) return null;

  const dims = opts?.dims && opts.dims > 0 ? opts.dims : embeddingDims();
  const base = ((opts?.baseUrl && opts.baseUrl.trim()) || env.OLLAMA_EMBEDDING_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const input = trimmed.slice(0, EMBEDDING_INPUT_MAX_CHARS);

  // 프로토콜 자동 분기 — base에 /v1 있으면 OpenAI 호환(BGE-M3 등), 없으면 Ollama 네이티브.
  const isOpenAi = /\/v1(\/|$)/.test(base);
  const url = isOpenAi ? `${base}/embeddings` : `${base}/api/embeddings`;
  const payload = isOpenAi ? { model, input: [input] } : { model, prompt: input };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // 실패를 조용히 삼키지 않는다(감사 R1: 대형 별표 30건이 무경고 skip돼 벡터 채널에서 통째 누락).
    // 반환은 기존대로 null(호출부 graceful) — 단 서버 로그에 사유를 남겨 재발을 감지 가능하게.
    if (!res.ok) {
      console.warn(`[embedding] HTTP ${res.status} (${model}, 입력 ${input.length}자) — null 반환`);
      return null;
    }
    const data = (await res.json()) as { embedding?: number[]; data?: { embedding?: number[] }[] };
    const vec = isOpenAi ? data.data?.[0]?.embedding : data.embedding;
    if (!Array.isArray(vec) || vec.length !== dims) {
      console.warn(`[embedding] 차원 불일치 또는 빈 응답 (기대 ${dims}, 실제 ${Array.isArray(vec) ? vec.length : "없음"}) — null 반환`);
      return null;
    }
    return vec;
  } catch (e) {
    console.warn(`[embedding] 요청 실패 (${model}): ${e instanceof Error ? e.message : String(e)} — null 반환`);
    return null;
  }
}

/**
 * 임베딩 서버 사전 점검 — 실제로 한 건 임베딩해 보고 응답·차원까지 확인한다.
 *
 * 재임베딩은 옛 벡터를 지우고 새로 만드는 작업이라, 서버가 죽어 있으면 벡터만 사라진다
 * (실측: Ollama 미기동 상태로 편람을 적재해 청크 55개가 벡터를 잃었다).
 * 그래서 적재 같은 파괴적 작업은 이 점검을 먼저 통과시킨 뒤에만 진행한다.
 */
export async function checkEmbeddingHealth(
  opts?: { model?: string; dims?: number; baseUrl?: string },
): Promise<{ ok: boolean; reason?: string }> {
  const model = (opts?.model && opts.model.trim()) || env.OLLAMA_EMBEDDING_MODEL;
  if (!model) return { ok: false, reason: "임베딩 모델이 설정되지 않았습니다." };
  const base = ((opts?.baseUrl && opts.baseUrl.trim()) || env.OLLAMA_EMBEDDING_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const dims = opts?.dims && opts.dims > 0 ? opts.dims : embeddingDims();
  const vec = await getEmbedding("연결 확인", opts);
  if (vec) return { ok: true };
  return { ok: false, reason: `임베딩 서버에 연결할 수 없거나 응답이 올바르지 않습니다 (${model} · ${base} · ${dims}차원). 서버 기동 여부를 확인해 주세요.` };
}
