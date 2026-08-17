# MongoDB 연결 및 스키마 현황

> **연결 테스트**: `npm run db:status`로 연결을 확인합니다(로컬 mongod 기준).

---

## 1. 연결 방식

- **드라이버**: Mongoose (Next.js API/서버에서 사용)
- **연결 코드**: `src/lib/db.ts` — `connectDb()` 호출 시 `env.MONGODB_URI`로 연결, 전역 단일 연결 유지
- **환경 변수**: `.env.local` 또는 배치/쉘에서 `MONGODB_URI` 설정 (폐쇄망 전제 — 로컬 mongod 전용)  
  - 로컬 예: `mongodb://127.0.0.1:27017/axplayground`  
  - DB명은 `MONGODB_DB`가 URI 경로보다 우선하며, 미설정 시 `axplayground`로 기본값 적용됩니다.
- **로컬 Docker(`docker-compose.yml`)**: mongo 포트가 `"127.0.0.1:27017:27017"` **루프백 바인딩**으로 설정되어 있어, 같은 서버의 앱(Next.js)만 `127.0.0.1`로 접근 가능하고 **내부망의 다른 PC에서는 직접 접속할 수 없습니다**.

---

## 2. 연결 확인 방법

| 방법 | 설명 |
|------|------|
| **스크립트** | `npm run db:status` — 컬렉션 목록 및 문서 수 출력 (MONGODB_URI만 필요) |
| **API** | `GET /api/db/status` — 연결 여부, 컬렉션 목록·문서 수, 스키마 요약 JSON 반환 (개발 서버 실행 후) |
| **헬스** | `GET /api/health` — DB 연결만 확인, `{ ok: true }` 반환 |

---

## 3. 현재 DB 상태

- **데이터베이스명**: `axplayground` (`MONGODB_DB` 우선, 미설정 시 기본값)
- **컬렉션 수**: 실시간 기준은 `npm run db:status` 또는 `GET /api/db/status`에서 확인하세요(컬렉션명·문서 수가 단일 기준(SSOT)). 하드코딩된 스냅샷 대신 라이브 조회를 사용합니다.

현재 DB에는 약 20개 컬렉션이 존재합니다 — 아래 4장에 문서화된 14개 스키마 모델에 더해, 기능 확장으로 추가된 `adreviewcriterias`·`adindustryrules`·`quizrankings`·`libraryposts`·`salesorders`·`playgroundconfigs`·`featureusages`·`rag_regulation`/`internalregulations` 등이 포함됩니다. (정확한 목록·건수는 위 `db:status`/`/api/db/status` 참고 — 문서에 건수를 하드코딩하지 않습니다.)

> **사규 하이브리드 RAG 컬렉션**: `rag_regulation`(사규 본문·청크) 외에 `rag_vectors`(청크 임베딩, bge-m3 1024d — 의미검색)·`rag_graph_edges`(지식그래프: 참조·위계·외부법령 엣지 — 그래프 확장)가 추가됐다. 스키마·처리방식은 [RAG_GRAPHRAG.md](RAG_GRAPHRAG.md). 두 컬렉션은 Mongoose 모델이 아니라 빌드 스크립트/증분 로직이 직접 관리하는 raw 컬렉션이다.

※ 일부 컬렉션은 앱에서 **첫 문서 저장 시** Mongoose에 의해 자동 생성됩니다. (`auditlogs`·`guardconfigs`·`guardratelimits`는 LLM 가드레일(M09) 관련 컬렉션 — 스키마는 4.12~4.14 참고)

---

## 4. 스키마(데이터 구조) 현황

모델 파일 위치: `src/models/*.ts`

### 4.1 users (User)

> 구 임직원 동선의 사용자 모델. 현재 임직원 로그인은 없으나(무인증) 모델 자체는 일부 보조 화면/시드에서 참조되어 보존합니다.

| 필드 | 타입 | 비고 |
|------|------|------|
| email | String | required, unique, index |
| name | String | required |
| dept | String | required, index |
| position | String | |
| totalPoints | Number | required, default 0, index |
| monthlyPoints | Number | required, default 0, index |
| lastLoginAt | Date | 레거시 필드(구 로그인 흔적, 현재 무인증) |
| createdAt | Date | timestamps |

---

### 4.2 notices (Notice)

| 필드 | 타입 | 비고 |
|------|------|------|
| title | String | required |
| content | String | required |
| isActive | Boolean | required, default true, index |
| createdBy | String | |
| createdAt | Date | timestamps |

---

### 4.3 quizpools (QuizPool)

| 필드 | 타입 | 비고 |
|------|------|------|
| question | String | required |
| choices | [String] | required |
| answerIndex | Number | required |
| createdAt | Date | timestamps |

---

### 4.4 quizlogs (QuizLog)

| 필드 | 타입 | 비고 |
|------|------|------|
| userId | ObjectId | required, ref: User, index |
| quizId | ObjectId | required, ref: QuizPool, index |
| isCorrect | Boolean | required |
| quizDate | String | required, index (YYYY-MM-DD) |
| answeredAt | Date | required |
| 복합 인덱스 | (userId, quizDate) | unique (유저별 일 1회) |

---

### 4.5 vocitems (VocItem)

| 필드 | 타입 | 비고 |
|------|------|------|
| title | String | required |
| content | String | required |
| status | String | enum: registered, reviewing, completed, default registered |
| dept | String | required, index |
| createdBy | ObjectId | required, ref: User, index |
| assignedTo | ObjectId | ref: User |
| aiSuggestion | String | |
| reply | String | |
| repliedBy | ObjectId | ref: User |
| createdAt, updatedAt | Date | timestamps |

---

### 4.6 lawconsults (LawConsult)

| 필드 | 타입 | 비고 |
|------|------|------|
| title | String | required |
| facts | String | required |
| issues | String | |
| status | String | enum: registered, reviewing, completed, default registered |
| dept | String | required, index |
| createdBy | ObjectId | required, ref: User, index |
| assignedTo | ObjectId | ref: User |
| aiOpinion | String | |
| finalOpinion | String | |
| createdAt, updatedAt | Date | timestamps |

---

### 4.7 pointlogs (PointLog)

| 필드 | 타입 | 비고 |
|------|------|------|
| userId | ObjectId | required, ref: User, index |
| type | String | required, enum: login, quiz, prompt_register, like_received, admin, index |
| amount | Number | required |
| refId | String | |
| createdAt | Date | timestamps |

---

### 4.8 prompts (Prompt)

| 필드 | 타입 | 비고 |
|------|------|------|
| title | String | required |
| content | String | required |
| category | String | required, enum: sales, law, safety, pr, cs, hr, index |
| createdBy | ObjectId | required, ref: User, index |
| likeCount | Number | required, default 0, index |
| likedBy | [ObjectId] | default [], ref: User |
| createdAt | Date | timestamps |

---

### 4.9 pressreleases (PressRelease)

| 필드 | 타입 | 비고 |
|------|------|------|
| title | String | required |
| body | String | required |
| status | String | required, enum: draft, submitted, confirmed, default draft |
| createdBy | ObjectId | required, ref: User |
| createdAt, updatedAt | Date | timestamps |

---

### 4.10 resources (Resource)

| 필드 | 타입 | 비고 |
|------|------|------|
| title | String | required |
| type | String | required, enum: video, document, index |
| category | String | required, index |
| fileUrl | String | |
| thumbnailUrl | String | |
| viewCount | Number | required, default 0, index |
| createdBy | String | |
| createdAt | Date | timestamps |

---

### 4.11 safetyarticles (SafetyArticle)

| 필드 | 타입 | 비고 |
|------|------|------|
| title | String | required |
| content | String | required |
| type | String | required, enum: news, library, index |
| thumbnailUrl | String | |
| createdAt, updatedAt | Date | timestamps |

---

### 4.12 auditlogs (AuditLog)

> LLM 가드레일(M09) 감사 로그. 모든 가드 호출(통과·차단·오류)이 1건씩 기록되며, 파일 로그(`/var/log/axp-audit.log`)와 **이중 저장**됩니다. 이쪽은 검색·일일 리포트용.

| 필드 | 타입 | 비고 |
|------|------|------|
| requestId | String | required, index |
| userId | String | default null, index |
| role | String | default null |
| ip | String | default null |
| panel | String | required, index |
| outcome | String | required, enum: pass, blocked, error, index |
| stage | String | enum: input, model, output, null (default null) |
| ruleId | String | default null, index |
| inputLen | Number | default 0 |
| outputLen | Number | default 0 |
| maskedTypes | [String] | default [] (출력에서 마스킹된 PII/시크릿 타입) |
| latencyMs | Number | default 0 |
| inputText | String | default null (`AUDIT_LOG_FULL_TEXT=true`일 때만 채움) |
| outputText | String | default null (`AUDIT_LOG_FULL_TEXT=true`일 때만 채움) |
| createdAt | Date | timestamps (updatedAt 없음) |
| 복합 인덱스 | (createdAt, outcome) | 일일 리포트 집계용 {createdAt:-1, outcome:1} |

---

### 4.13 guardconfigs (GuardConfig)

> 가드레일 런타임 설정 **싱글톤**(`key="default"`). 제어판(`/admin/guardrails`)에서 수정하면 게이트웨이가 이 값을 참조합니다(캐시 TTL 30초).

| 필드 | 타입 | 비고 |
|------|------|------|
| key | String | required, unique, default "default" |
| enableLength | Boolean | default true |
| enableInjection | Boolean | default true |
| enablePii | Boolean | default true |
| enableRateLimit | Boolean | default true |
| enableOutputPiiMask | Boolean | default true |
| enableOutputSecrets | Boolean | default true |
| enableAudit | Boolean | default true |
| maxInputChars | Number | default 8000 |
| rateLimitPerWindow | Number | default 30 |
| rateLimitWindowSec | Number | default 60 |
| injectionThreshold | Number | default 3 |
| blockOnInputPii | [String] | default ["RRN","FRN","CARD","ACCOUNT"] (입력 차단 대상 PII 타입) |
| updatedBy | String | default null |
| createdAt, updatedAt | Date | timestamps |

---

### 4.14 guardratelimits (GuardRateLimit)

> 요청 속도 제한용 카운터. `key`는 `"${type}:${value}:${panel}:${windowStartMs}"` 형태로 분 단위 버킷을 식별. `expiresAt` TTL 인덱스로 윈도우 만료 시 Mongo가 **자동 삭제**(별도 청소 작업 불필요).

| 필드 | 타입 | 비고 |
|------|------|------|
| key | String | required, unique, index |
| panel | String | required |
| count | Number | required, default 0 |
| windowStart | Date | required |
| expiresAt | Date | required, TTL 인덱스(expireAfterSeconds: 0 → expiresAt 시점에 만료) |
| createdAt | Date | timestamps (updatedAt 없음) |

---

## 5. 요약

- **MongoDB 연결**: `connectDb()` → `MONGODB_URI`(DB명 `axplayground`, `npm run db:status`로 확인)
- **컬렉션**: 실시간 목록·건수는 `npm run db:status`/`GET /api/db/status` 참고(약 20개, 일부는 첫 사용 시 자동 생성)
- **스키마**: 위 14개 모델에 정의되어 있으며, Mongoose 기본 규칙으로 컬렉션명은 **소문자 복수형** (예: User → users)
- **LLM 가드레일(M09)**: `auditlogs`(감사 로그)·`guardconfigs`(런타임 설정 싱글톤)·`guardratelimits`(속도 제한 카운터) 3개 컬렉션 추가 — 자세한 스키마는 4.12~4.14 참고

---

## 6. 리포지토리에 포함된 로컬 DB 스냅샷

`data/mongo-snapshot/`에 **mongodump** 결과(BSON)가 들어 있습니다. 복원 순서·주의사항은 같은 디렉토리의 README(영문)를 참고하세요: [`data/mongo-snapshot/README.md`](../data/mongo-snapshot/README.md). 덤프에는 개발용 샘플 데이터가 포함될 수 있으므로 공개 범위를 검토하세요.

