import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * AX Playground 운영 설정 (싱글톤: key="default"). GuardConfig 패턴.
 * 관리자 제어판(P10)에서 수정 → 캐시 무효화(TTL 30초).
 */
const PlaygroundConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    /** 인기게시물 산정 기간(일). */
    popularWindowDays: { type: Number, default: 14 },
    /** 인기 노출 최소 좋아요 수. */
    popularMinLikes: { type: Number, default: 1 },
    /** 인기 스트립 노출 개수. */
    popularCount: { type: Number, default: 5 },
    /** 퀴즈 제한시간(초). (P3은 클라 기본 15초; 설정화 여지) */
    quizTimeLimitSec: { type: Number, default: 15 },
    /** 기관명 — 문서 생성·화면·프롬프트의 기관 고유 문구에 사용. 관리자 설정에서 입력. */
    orgName: { type: String, default: "" },
    /** 대표자 성명 — 보도자료 등에 사용. 비우면 "○○○" 플레이스홀더. */
    ceoName: { type: String, default: "" },
    /**
     * 패널 진입 스플래시 기여자·배지.
     * { [패널key]: { ideaBy: string[], codeBy: string[], badge: "contest"|"ceo"|"demand"|"" } }
     * 비우면 코드 기본값(src/lib/panel-intro.ts) 사용.
     */
    panelIntro: { type: Schema.Types.Mixed, default: {} },
    /**
     * 메인 건물(기능) 오버라이드 — 기관별 커스터마이징.
     * { [건물id]: { label?, desc?, externalUrl?, hidden? } } (src/lib/playground-map.ts BuildingOverride)
     * 핵심 4기능(quiz·library·search·docs)은 externalUrl·hidden 불가(sanitize에서 차단).
     */
    panelOverrides: { type: Schema.Types.Mixed, default: {} },
    /** LLM 서버(OpenAI 호환) base URL — 비우면 env 사용. */
    llmBaseUrl: { type: String, default: "" },
    /** LLM API 키 — 비우면 env 사용(폐쇄망은 보통 불필요). 비밀값. */
    llmApiKey: { type: String, default: "" },
    /** 기본 LLM 모델 — feature 미지정 시. 비우면 env 사용. */
    llmDefaultModel: { type: String, default: "" },
    /** feature(패널)별 모델 매핑 { knowledge: "modelA", docs: "modelB" }. */
    featureModels: { type: Schema.Types.Mixed, default: {} },
    /** 이미지 업로드 최대 MB. */
    uploadImageMb: { type: Number, default: 10 },
    /** 일반/영상 첨부 최대 MB. */
    uploadFileMb: { type: Number, default: 100 },
    /** 사규검색: 임베딩(의미) 검색 사용 여부. */
    ragVectorEnabled: { type: Boolean, default: true },
    /** 사규검색: 그래프(참조·위계) 확장 사용 여부. */
    ragGraphEnabled: { type: Boolean, default: true },
    /** 임베딩 서버(Ollama) base URL — 비우면 env(OLLAMA_EMBEDDING_BASE_URL) 또는 127.0.0.1:11434. */
    embedBaseUrl: { type: String, default: "" },
    /** 임베딩 모델명(Ollama) — 비우면 env(OLLAMA_EMBEDDING_MODEL). 변경 시 벡터 재빌드 필요. */
    embedModel: { type: String, default: "" },
    /** 임베딩 차원 — 비우면 env(EMBEDDING_DIMENSIONS). 저장된 벡터 차원과 일치해야 함. */
    embedDims: { type: Number, default: 0 },
    /** 관리자 접속 허용 IP(콤마 구분, 단일/IPv4 CIDR). 비면 제한 없음. env ADMIN_ALLOWED_IPS와 합산. */
    adminAllowedIps: { type: String, default: "" },
    /** 관리자 암호 해시(scrypt salt:hash) — 설정 시 env ADMIN_ACCESS_KEY보다 우선. 비밀값. */
    adminKeyHash: { type: String, default: "" },
    /** 안전 게시판 관리 비밀번호 해시(scrypt) — 뉴스/자료 등록·수정·삭제 권한. 비밀값. */
    safetyBoardPwHash: { type: String, default: "" },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

export type PlaygroundConfigDoc = InferSchemaType<typeof PlaygroundConfigSchema>;
export const PlaygroundConfigModel = models.PlaygroundConfig ?? model("PlaygroundConfig", PlaygroundConfigSchema);
