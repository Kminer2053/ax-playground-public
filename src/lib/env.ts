import { z } from "zod";

/** 문자열 env를 정수로(미설정·오류 시 기본값). */
const intEnv = (def: number) => (v: unknown) => {
  if (typeof v === "string" && v.trim().length > 0) {
    const n = parseInt(v.trim(), 10);
    return Number.isNaN(n) ? def : n;
  }
  return def;
};

const EnvSchema = z.object({
  /** 빌드 시 없으면 placeholder 사용. 실제 런타임에서는 connectDb 시 필수. */
  MONGODB_URI: z.preprocess(
    (val) => (typeof val === "string" && val.length > 0 ? val : "mongodb://build-placeholder"),
    z.string().min(1)
  ),
  /** 사용할 DB 이름. 미설정 시 axplayground. URI에 db 경로가 있어도 이 값이 우선한다. */
  MONGODB_DB: z.preprocess(
    (val) => (typeof val === "string" && val.trim().length > 0 ? val.trim() : "axplayground"),
    z.string().min(1)
  ),
  /** 빌드 시 값이 없거나 32자 미만이면 임시값 사용(빌드 통과용). 실제 운영 시 `.env.local`(또는 서버 환경변수)에 32자 이상으로 반드시 설정할 것. */
  SESSION_SECRET: z.preprocess(
    (val) => (typeof val === "string" && val.length >= 32 ? val : "build-placeholder-32-chars!!!!!!!!"),
    z.string().min(32)
  ),
  NEXT_PUBLIC_BASE_URL: z.string().url().optional(),
  /**
   * OpenAI 호환 채팅 API (내부망 로컬 Ollama 등). base URL 예: http://127.0.0.1:11434/v1
   * 외부 API는 사용하지 않으며, 모든 채팅 LLM 호출은 이 엔드포인트로 향합니다.
   */
  OPENAI_COMPATIBLE_BASE_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim().replace(/\/$/, "") : undefined),
    z.string().url().optional()
  ),
  OPENAI_COMPATIBLE_MODEL: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().min(1).optional()
  ),
  /** Ollama 등은 임의 문자열 가능. 미설정 시 "ollama" 사용 */
  OPENAI_COMPATIBLE_API_KEY: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().optional()
  ),
  /** Ollama 임베딩 모델 (예: nomic-embed-text). 사규 RAG·시드·재임베딩에 사용 */
  OLLAMA_EMBEDDING_MODEL: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().min(1).optional()
  ),
  /** 기본 http://127.0.0.1:11434 — 코드에서 보완 */
  OLLAMA_EMBEDDING_BASE_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim().replace(/\/$/, "") : undefined),
    z.string().url().optional()
  ),
  /**
   * 임베딩 벡터 차원. 미설정 시 기본 768(nomic-embed-text 등).
   * 다른 모델이면 반드시 모델 출력 차원과 동일하게 설정.
   */
  EMBEDDING_DIMENSIONS: z.preprocess(
    (v) => {
      if (typeof v === "string" && v.trim().length > 0) {
        const n = parseInt(v.trim(), 10);
        return Number.isNaN(n) ? undefined : n;
      }
      return undefined;
    },
    z.number().int().positive().optional()
  ),
  /** 국가법령정보센터(법제처) Open API 기관코드(OC). 이메일 ID 또는 마이페이지 OC값. */
  LAW_API_OC: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string().optional()),
  /** 가드레일 감사 로그 파일 경로 (M09). 기본 /var/log/axp-audit.log. 쓰기 실패 시 fail-open. */
  AUDIT_LOG_FILE: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().optional()
  ),
  /** 감사 로그에 입·출력 전문 기록 여부. "false"면 길이·메타만 기록. 기본 전문 기록. */
  AUDIT_LOG_FULL_TEXT: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() !== "false" : true),
    z.boolean()
  ),
  /** 관리자 페이지 진입 암호키 (AX Playground — 로그인 없음, 관리자만 키 인증). 8자 이상. */
  ADMIN_ACCESS_KEY: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().min(8).optional()
  ),
  /** 관리자 접속 허용 IP(콤마 구분, 단일 IP 또는 IPv4 CIDR). 부트스트랩/복구용 — DB 설정과 합집합. 비면 제한 없음. */
  ADMIN_ALLOWED_IPS: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().optional()
  ),
  /** 신뢰 리버스프록시 홉 수(SEC-002). X-Forwarded-For에서 '뒤에서 N번째'를 실제 클라이언트 IP로 신뢰.
   *  기본 1(프록시 1대가 실 IP를 덧붙이는 표준 구성). 0이면 XFF를 신뢰하지 않음(직접 노출 배포 — IP 제한은 loopback만). */
  ADMIN_TRUSTED_PROXY_HOPS: z.preprocess(intEnv(1), z.number().int().nonnegative()),
  /** 출력 마스킹에 추가할 공인/고정 IP 목록(콤마 구분, SEC-008). 소스에 IP를 하드코딩하지 않도록 분리. */
  MASK_EXTRA_IPS: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().optional()
  ),
  /** 업로드 파일 저장 디렉토리. 미설정 시 <app>/uploads (코드에서 보완). */
  UPLOAD_DIR: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().optional()
  ),
  /** 동시 LLM 호출 상한(전역 세마포어). 내부 모델 서버 용량에 맞춰 조정. 기본 8. */
  LLM_MAX_CONCURRENCY: z.preprocess(intEnv(8), z.number().int().positive()),
  /** LLM 대기열 상한 — 초과 시 즉시 503(백프레셔). 기본 24. */
  LLM_MAX_QUEUE: z.preprocess(intEnv(24), z.number().int().nonnegative()),
  /** LLM 요청 타임아웃(ms) — 과부하 시 장시간 hang 방지. 기본 180000(3분). */
  LLM_TIMEOUT_MS: z.preprocess(intEnv(180_000), z.number().int().positive()),
  /** 모델 서버 컨텍스트 창(토큰) — 서버측 무음 절단 방지용 앱측 예산의 기준. Ollama num_ctx와 일치시킬 것. 기본 8192. */
  LLM_NUM_CTX: z.preprocess(intEnv(8192), z.number().int().positive()),
  /** LLM 클라이언트 재시도 횟수 — 과부하 증폭 방지로 기본 1. */
  LLM_MAX_RETRIES: z.preprocess(intEnv(1), z.number().int().nonnegative()),
  /** 무거운 자식 프로세스(HWPX·OCR·kordoc) 동시 실행 상한. 기본 4. */
  SUBPROC_MAX_CONCURRENCY: z.preprocess(intEnv(4), z.number().int().positive()),
  /** 자식 프로세스 대기열 상한 — 초과 시 거절. 기본 12. */
  SUBPROC_MAX_QUEUE: z.preprocess(intEnv(12), z.number().int().nonnegative()),
});

export const env = EnvSchema.parse({
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DB: process.env.MONGODB_DB,
  SESSION_SECRET: process.env.SESSION_SECRET,
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  OPENAI_COMPATIBLE_BASE_URL: process.env.OPENAI_COMPATIBLE_BASE_URL,
  OPENAI_COMPATIBLE_MODEL: process.env.OPENAI_COMPATIBLE_MODEL,
  OPENAI_COMPATIBLE_API_KEY: process.env.OPENAI_COMPATIBLE_API_KEY,
  OLLAMA_EMBEDDING_MODEL: process.env.OLLAMA_EMBEDDING_MODEL,
  OLLAMA_EMBEDDING_BASE_URL: process.env.OLLAMA_EMBEDDING_BASE_URL,
  EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS,
  LAW_API_OC: process.env.LAW_API_OC,
  AUDIT_LOG_FILE: process.env.AUDIT_LOG_FILE,
  AUDIT_LOG_FULL_TEXT: process.env.AUDIT_LOG_FULL_TEXT,
  ADMIN_ACCESS_KEY: process.env.ADMIN_ACCESS_KEY,
  ADMIN_ALLOWED_IPS: process.env.ADMIN_ALLOWED_IPS,
  ADMIN_TRUSTED_PROXY_HOPS: process.env.ADMIN_TRUSTED_PROXY_HOPS,
  MASK_EXTRA_IPS: process.env.MASK_EXTRA_IPS,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
  LLM_MAX_CONCURRENCY: process.env.LLM_MAX_CONCURRENCY,
  LLM_MAX_QUEUE: process.env.LLM_MAX_QUEUE,
  LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
  LLM_NUM_CTX: process.env.LLM_NUM_CTX,
  LLM_MAX_RETRIES: process.env.LLM_MAX_RETRIES,
  SUBPROC_MAX_CONCURRENCY: process.env.SUBPROC_MAX_CONCURRENCY,
  SUBPROC_MAX_QUEUE: process.env.SUBPROC_MAX_QUEUE,
});

