# AX Playground

**AX Playground**는 공공기관·기업 임직원의 **AI 리터러시 향상과 사내 AI 업무 도구 체험**을 위한 내부망 전용 플랫폼입니다. 기존 업무 포털형 UI(AX Portal)를 **놀이공원(Playground) 컨셉의 단일 이미지맵**으로 재구성하여, 9개의 AI 기능을 건물처럼 배치하고 클릭 한 번으로 진입하도록 만들었습니다.

Next.js 16 App Router 기반 풀스택 앱이며, MongoDB(Mongoose), **내부망 로컬 LLM(OpenAI 호환 Chat API — MLX-VLM / Ollama 등, 멀티모달 지원)**, 사규 RAG(MongoDB 텍스트 검색), iron-session(관리자 전용)을 사용합니다.

> **로그인 없는 임직원 사용**: 일반 임직원은 별도 로그인 없이 전 기능을 사용합니다. 관리자 기능(`/admin`)만 암호키(`ADMIN_ACCESS_KEY`) 인증을 거칩니다. (구 `/login`·`/setup`은 레거시 리다이렉트로만 남아 있습니다.)

> **사규 RAG 검색 방식**: 현재 사규 검색은 **MongoDB `$text` 전문검색 + 정규식(RegExp) 키워드 매칭**으로 동작합니다(벡터·임베딩·코사인 유사도 미사용). 임베딩 관련 코드·환경변수(`embedding` 필드, `OLLAMA_EMBEDDING_MODEL`, `lib/embedding.ts` 등)는 존재하지만 **현재 사규 검색에는 호출되지 않는 비활성 잔재**이며, 향후 벡터 검색(Qdrant 등 to-be) 도입에 대비한 예약 상태입니다.

> **모든 LLM 호출은 내부망 가드레일 게이트웨이**(`src/lib/guardrails/`)를 경유합니다 — 입력 검사(길이·인젝션·PII·rate limit) → 모델 제어(시스템 프롬프트) → 출력 검사(PII/시크릿 마스킹·악성코드 차단) → 감사 로그. 관리자 대시보드(`/admin` → 가드레일 탭)에서 모니터링·런타임 제어가 가능합니다. (근거: 국가·공공기관 AI보안 가이드북 v2.0 / 상세: [`docs/guardrail-mapping.md`](./guardrail-mapping.md))

## AX Portal → AX Playground 전환

이 저장소는 조직 원본(업무 포털형 AX Portal)을 **로컬 PC(MongoDB·로컬 LLM)에서 즉시 구동되도록 재구성한 로컬 기반 작동 모델**이며, 그 위에서 **AX Playground로의 전면 전환(P0~P11)**을 수행한 결과물입니다.

| 영역 | AX Portal (구) | AX Playground (현) |
|------|----------------|--------------------|
| **진입 UX** | 로그인 → 업무 포털 대시보드(`/main-portal`) | 무로그인 → 놀이공원 이미지맵(`/`) |
| **인증** | 전 페이지 iron-session 로그인 게이팅 | 임직원 무인증, **관리자만** 암호키 인증 |
| **기능 구성** | 매출·법무·안전·홍보·VOC·모니터링 6패널 | AI 리터러시·라이브러리·지식검색·매출분석·문서작성·안전·민원답변·광고심의·매거진 **9기능** |
| **관리자** | `/admin/guardrails` (가드레일만) | `/admin` **6탭 통합 대시보드** (사용통계·가드레일·퀴즈·라이브러리·기준데이터·설정) |
| **LLM** | 내부 로컬 LLM(텍스트) | 내부 로컬 LLM **+ 멀티모달(이미지)** — 안전 사진 진단·광고 도안 심의 |
| **모바일/iframe** | 모바일 전용 라우트(`/m`), CS iframe | 제거(단일 반응형) |
| **네이밍** | `claude.ts`·`chatClaude` 등 레거시 명 | `llm.ts`·`chatLlm` 등으로 정리(실제 Anthropic 미사용) |

> AX Playground는 실제 Anthropic Claude API를 사용하지 않습니다. 모든 생성 기능은 **내부망 로컬 LLM(OpenAI 호환)**으로 동작하며, 관련 SDK·식별자·문구를 모두 LLM 중립 명칭으로 정리했습니다.

---

## LLM 설정: 내부망 로컬 전용 정책

앱의 생성 LLM은 **내부망 로컬(OpenAI 호환) 엔드포인트 전용**입니다. 외부 API(Anthropic·OpenAI·Google 등)는 사용하지 않으며, 외부 인터넷은 차단된 폐쇄망을 전제로 합니다.

1. **생성 LLM (채팅·지식검색·민원답변·문서작성·안전·광고심의 — 내부 로컬 전용)**
   - `OPENAI_COMPATIBLE_BASE_URL` + `OPENAI_COMPATIBLE_MODEL`(필요 시 `OPENAI_COMPATIBLE_API_KEY`)을 설정합니다. (`src/lib/llm.ts`)
   - 로컬에서는 보통 MLX-VLM 서버(`http://127.0.0.1:8080/v1`) 또는 Ollama(`http://127.0.0.1:11434/v1`)를 가리킵니다.
   - **멀티모달**: 안전 사진 진단·광고 도안 심의는 이미지를 함께 전송합니다. 모델은 OpenAI 호환 `image_url` content를 처리할 수 있는 비전 모델이어야 합니다(예: `gemma-4-e2b-it`).
   - 모든 호출은 가드레일 게이트웨이(`guardedChat`/`guardedStreamChat`)를 경유합니다.

2. **사규 RAG 검색 (현재: 텍스트 검색)**
   - 현재 사규 검색은 **MongoDB `$text` 전문검색 + 정규식 키워드 매칭**으로 동작하며, **별도 임베딩 설정 없이 작동**합니다.
   - `OLLAMA_EMBEDDING_MODEL`·`OLLAMA_EMBEDDING_BASE_URL`·`EMBEDDING_DIMENSIONS`는 **현재 미사용(비활성)**이며, 향후 벡터 검색 도입 대비 예약 변수입니다.

3. **외부 네트워크**
   - 국가법령 Open API(`LAW_API_OC`)는 인터넷·기관 코드가 필요할 수 있는 **선택 의존**입니다. AI 리서치매거진의 표기용 외부 URL 1건을 제외하면 런타임은 외부 API를 호출하지 않습니다.

전체 변수 목록은 [환경 변수](#환경-변수)와 `.env.example`을 참고하세요.

---

## 목차

- [AX Portal → AX Playground 전환](#ax-portal--ax-playground-전환)
- [LLM 설정: 내부망 로컬 전용 정책](#llm-설정-내부망-로컬-전용-정책)
- [기술 스택](#기술-스택)
- [프로젝트 구조](#프로젝트-구조)
- [주요 기능](#주요-기능)
- [API 개요](#api-개요)
- [데이터 모델](#데이터-모델)
- [화면·컴포넌트 구성](#화면컴포넌트-구성)
- [시작하기](#시작하기)
- [환경 변수](#환경-변수)
- [스크립트](#스크립트)
- [사규 RAG 파이프라인](#사규-rag-파이프라인)
- [LLM 가드레일](#llm-가드레일)
- [로컬 MongoDB 스냅샷](#로컬-mongodb-스냅샷)
- [라우팅·접근 정책](#라우팅접근-정책)
- [핵심 라이브러리](#핵심-라이브러리)
- [추가 문서](#추가-문서)

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| **프레임워크** | Next.js 16 (App Router, React Server Components, Turbopack) |
| **프론트엔드** | React 19, Tailwind CSS 4, Noto Sans KR 로컬 번들(폐쇄망 대응) |
| **백엔드** | Next.js API Routes (Route Handlers) |
| **언어** | TypeScript 5 |
| **DB** | MongoDB (Mongoose) |
| **인증** | iron-session (관리자 전용 쿠키 세션) |
| **LLM** | 내부망 로컬 LLM — OpenAI 호환 API(MLX-VLM/Ollama 등, `OPENAI_COMPATIBLE_*`), **멀티모달(이미지) 지원**. 외부 API 미사용 |
| **가드레일** | 자체 구현(TypeScript) — 입력/모델/출력 3단계 + 감사 로그·대시보드 (`src/lib/guardrails/`) |
| **사규 검색** | MongoDB `$text` 전문검색 + 정규식 키워드 매칭 (임베딩·벡터 미사용) |
| **임베딩(비활성)** | Ollama 임베딩 코드·변수(`OLLAMA_EMBEDDING_MODEL`, 기본 차원 768)는 존재하나 현재 사규 검색에 **미사용**, 향후 벡터 검색 대비 예약 |
| **파일 업로드** | 라이브러리 썸네일·자료 파일 로컬 저장 (`UPLOAD_DIR`, 기본 `public/uploads`) |
| **빌드 도구** | tsx (스크립트 실행), ESLint 9, PostCSS |

---

## 프로젝트 구조

아래 트리는 **저장소 루트 기준**입니다. 저장소 루트가 곧 앱 루트이며(별도 하위 디렉토리 없음), 개발은 저장소 루트에서 바로 진행합니다.

```
ax-playground/
├── src/
│   ├── app/                          # Next.js App Router 페이지 & API
│   │   ├── page.tsx                  # 메인 — 놀이공원 이미지맵 (PlaygroundHome)
│   │   ├── quiz/page.tsx             # ① AI 리터러시 리더보드(서바이벌 퀴즈)
│   │   ├── library/page.tsx          # ② AX 라이브러리(3게시판)
│   │   │
│   │   ├── panel/                    # 패널형 기능 라우트
│   │   │   ├── knowledge/page.tsx    # ③ AI 지식검색(사규 RAG)
│   │   │   ├── sales/                # ④ AI 매출분석 — page(허브)·compare·trend
│   │   │   ├── docs/page.tsx         # ⑤ AI 문서작성
│   │   │   ├── safety/page.tsx       # ⑥ 스마트 안전관리(멀티모달)
│   │   │   ├── cs-answer/page.tsx    # ⑦ AI 민원답변
│   │   │   ├── ad-review/page.tsx    # ⑧ AI 광고도안심의(멀티모달·무저장)
│   │   │   └── magazine/page.tsx     # ⑨ AI 리서치매거진
│   │   │
│   │   ├── admin/                    # 관리자(암호키 인증)
│   │   │   ├── page.tsx              #   6탭 통합 대시보드(AdminDashboard)
│   │   │   └── guardrails/           #   레거시 경로 → /admin?tab=guardrails 리다이렉트
│   │   │       ├── page.tsx          #   redirect
│   │   │       └── GuardrailDashboardClient.tsx  # 가드레일 탭 본체
│   │   │
│   │   ├── safety/                   # 안전 부속 페이지(articles·chat·library·news)
│   │   ├── sales/page.tsx
│   │   │
│   │   └── api/                      # API Route Handlers (아래 [API 개요] 참고)
│   │       ├── quiz/                 #   next·pool·pool/[id]·ranking
│   │       ├── library/             #   list·[id]·[id]/vote·popular
│   │       ├── knowledge/           #   assistant(SSE)·regulations/*
│   │       ├── sales/diagnosis
│   │       ├── safety/              #   chat(멀티모달)·articles
│   │       ├── cs/answer
│   │       ├── ad/                  #   review(멀티모달·무저장)·industries
│   │       ├── ai/                  #   chat·status
│   │       ├── auth/                #   login·logout·me (레거시)
│   │       ├── admin/               #   auth·usage·playground-config·regulations·
│   │       │                        #   ad-rules·ad-criteria·guardrails/*
│   │       ├── health / db/status
│   │
│   ├── components/
│   │   ├── playground/               # 메인 이미지맵
│   │   │   ├── PlaygroundHome.tsx    #   메인 화면 셸(타이틀·리더보드·맵)
│   │   │   └── MainMap.tsx           #   놀이공원 레이어 맵(건물·라벨·클릭 핫스팟)
│   │   ├── panels/desktop/           # 기능 패널 컴포넌트
│   │   │   ├── PanelLaw.tsx          #   지식검색(RAG 검색 + 출처 팝업 + SSE)
│   │   │   ├── PanelSalesHub·Upload·Trend.tsx #   매출분석(허브·편의점비교·업종트렌드)
│   │   │   ├── PanelSafety.tsx       #   안전(자연어 + 사진 멀티모달 진단)
│   │   │   ├── PanelCsAnswer.tsx     #   민원답변(어조 선택·5단계 초안)
│   │   │   ├── PanelAdReview.tsx     #   광고도안 심의(이미지 업로드·4분야)
│   │   │   └── PanelMagazine.tsx     #   리서치매거진(InsightHub 소개)
│   │   ├── admin/                    # 관리자 대시보드
│   │   │   ├── AdminDashboard.tsx    #   6탭 프레임
│   │   │   ├── AdminKeyGate.tsx      #   암호키 입력 게이트
│   │   │   └── tabs/                 #   Usage·Quiz·Library·Data·Settings ManageTab
│   │   └── panel/                    # 공통 패널 유틸(BackToMain·BrandLogo·Iframe)
│   │
│   ├── models/                       # Mongoose 모델 (22개 — 아래 [데이터 모델])
│   │
│   ├── lib/                          # 핵심 라이브러리 (아래 [핵심 라이브러리])
│   │   ├── llm.ts                    #   내부 LLM(OpenAI 호환) — chatLlm/streamChatLlm(멀티모달)
│   │   ├── guardrails/               #   LLM 가드레일 게이트웨이
│   │   ├── playground-map.ts         #   메인맵 건물·기능 정의(9기능 + 관리자)
│   │   ├── playgroundConfig.ts       #   운영 설정 로더(인기 산정·퀴즈 제한시간, 캐시 30초)
│   │   ├── ad-review.ts / ad-rules.ts#   광고심의 프롬프트·룰셋 로더
│   │   ├── regulations-*.ts          #   사규 파싱·전처리·검색(RAG)
│   │   ├── usage.ts                  #   기능 사용량 집계(FeatureUsage)
│   │   ├── adminAuth.ts              #   관리자 인증(requireAdmin/isAdmin)
│   │   ├── upload.ts                 #   파일 업로드 저장
│   │   └── db.ts·session.ts·env.ts·points.ts·quiz.ts·nickname.ts·…
│   │
│   ├── scripts/                      # CLI 스크립트 (아래 [스크립트])
│   └── middleware.ts                 # 레거시 경로 리다이렉트(인증 게이팅은 라우트 레벨)
│
├── tools/hwpx/                       # HWPX 변환 파이프라인 (P6 — python 표준라이브러리 전용)
│   ├── scripts/                      #   compose_doc(4단계 통합)·press_builder(보도자료)·
│   │                                 #   extract_text(hwpx/docx 추출)·fix_namespaces(필수 후처리)·validate
│   ├── templates/format_*/standard.hwpx  # 양식별 표준 hwpx (1p·full·gongmun·press)
│   └── references/                   #   작성 원칙·레이아웃 규칙·양식 가이드(format-press.md 포함)
│
├── infra/                            # 운영 인프라 산출물(가드레일 모델·네트워크 레이어)
│   ├── ollama/Modelfile.ax           #   시스템 프롬프트 + 파라미터 제한
│   └── nginx/security.conf           #   모델 정보 유출 방지 헤더
│
├── data/regulations-2026/            # 사규 원본 (6분류: 규정·세칙·지침·매뉴얼·편람·계약서) — HWP·PDF + 정제 md/txt
├── data/mongo-snapshot/              # mongodump 스냅샷 (복원: 해당 폴더 README)
├── public/
│   ├── playground/                   #   메인맵 건물·배경 이미지
│   ├── fonts/                        #   Noto Sans KR woff2 (로컬 번들)
│   ├── uploads/                      #   라이브러리 업로드 저장(기본 UPLOAD_DIR)
│   └── sagyu.json                    #   클라이언트 사규 검색용(빌드 시 생성)
│
├── package.json
├── .env.local                        # 환경 변수 (git 제외)
└── .env.example                      # 환경 변수 템플릿
```

---

## 주요 기능

메인(`/`)은 놀이공원 이미지맵입니다. 각 건물에는 번호·기능명·설명 라벨이 항상 표기되며, 클릭하면 해당 기능으로 이동합니다. 중앙 성채는 **AI 리터러시 리더보드**(전광판), 상단에는 인트로 배너가 배치됩니다. 메인 매표소를 **5회 연속 클릭**하면 숨겨진 관리자 화면으로 진입합니다.

### ① AI 리터러시 리더보드 (`/quiz`)
- **서바이벌 퀴즈**: 문제 풀(`QuizPool`)에서 출제, 문항별 제한시간(`PlaygroundConfig.quizTimeLimitSec`), 연속 정답 **콤보** 보너스.
- **실시간 랭킹**: 닉네임 기반 점수(`QuizRanking` — `score`·`comboMax`·`playedAt`). 로그인 없이 닉네임만으로 참여, 메인 전광판에 상위권 노출.
- 효과음(`lib/sfx.ts`)·닉네임 생성(`lib/nickname.ts`)으로 가벼운 게이미피케이션.

### ② AX 라이브러리 (`/library`)
- **3개 게시판**(`LibraryPost.board`): 프롬프트 / 영상 / 자료. 게시물은 제목·본문·활용법(`usage`)·작성자와 함께, 게시판에 따라 **썸네일·첨부파일**(`thumbnailUrl`·`fileUrl`·`fileName`·`fileSize`)을 가질 수 있습니다.
- **좋아요/싫어요**(`up`·`down`)와 중복 방지 투표자 기록(`voters`, `lib/voterId.ts`), 관리자 **고정(pinned)**.
- **인기 게시물**: 운영 설정(`PlaygroundConfig`)의 산정 기간(`popularWindowDays`)·최소 좋아요(`popularMinLikes`)·노출 개수(`popularCount`)로 동적 산정. 관리자 라이브러리 탭에서 즉시 조정(30초 내 반영).

### ③ AI 지식검색 (`/panel/knowledge`)
- **사규 하이브리드 RAG**: 키워드(`$text`+정규식) + 의미(bge-m3 임베딩 코사인) + 지식그래프(참조·위계) 3채널. 재랭킹 3신호(의미·그래프정합성·제목특정성)로 보편어 편향 교정. 상세: [`RAG_GRAPHRAG.md`](RAG_GRAPHRAG.md).
- **컨텍스트 '조문' 선택**(2026-07): 문서 안에서 LLM에 실을 조문을 이진 스코어러+**벡터 조문힌트**+조문당 예산 캡·밀도창으로 선택 — "문서는 찾는데 정답 조문이 빠져 회피 답변"하던 문제 해소. 코어 파이프라인은 `regulations-search.ts` **공용 모듈**(문서작성 사이드챗과 공유).
- **AI 지식 어시스턴트**: 사규 근거를 붙여 자연어 질문에 답변. `POST /api/knowledge/assistant`에 `stream: true`이면 `text/event-stream`(SSE)로 토큰을 흘려보내고, 화면에 생성되는 대로 반영(UTF-8 스트림 경계 한글 깨짐 방지 처리 포함). **빠른검색/심층검색 2모드**(심층=LLM 의도 파악·키워드 확장 후 더 많은 조문 주입 + 규정 간 관계 배선), 근거는 위계(규정>세칙>지침>편람>매뉴얼>계약서) 순 정렬·인용은 **「규정명」** 표기.
- **출처 팝업**: 답변에 인용된 사규 조문을 클릭하면 원문 조문을 팝업으로 확인.
- **관리자 적재**: `/admin` 사규 적재 탭 — 업로드→파싱 미리보기(조문 **전체 본문** + 기존본 대비 **변경 4분류**(실질/명칭/마커/표기차)와 **조문 인라인 diff**)→교체/신규 적재. 자가검수 게이트, 스캔 PDF OCR, 시행일(최신 부칙)·연번(기존 승계) 자동. 적재 시 임베딩·그래프 **증분 갱신**(무변경 조문은 srcHash 재사용). CLI: `npm run reg:ingest`. 데이터 `data/regulations-2026`(6분류) — 동봉 샘플 9건, 기관 사규로 교체해 적재.

### ④ AI 매출분석 (`/panel/sales`) — 허브 → 2도구
- 진입 시 허브에서 **편의점 매출 비교** / **업종별 매출트렌드** 선택. 두 도구 모두 사내 매출시스템 엑셀을 **브라우저에서 직접 분석**(원본 서버 미전송)하고 **DB 저장 없음**. 분석 매장은 본부·역·매장명 자유 입력(현황 변동 대비).
- **편의점 매출 비교**(`/panel/sales/compare`): 엑셀 4종(일별·비교매장·통계·재고) 업로드 → KPI·ABC·카테고리·놓친매출·벤치마킹·재고예측 → **AI 진단**(요약 텍스트만 `POST /api/sales/diagnosis` 가드 경유 내부 LLM).
- **업종별 매출트렌드**(`/panel/sales/trend`): 엑셀 업로드 → 전사·역별·**전문점 대>중>소 드릴다운** 매출 차트 + 역간 비교 + 자연어 검색 + 예측 + 다운로드 가이드. **완전 클라이언트(LLM 없음)**.

### ⑤ AI 문서작성 (`/panel/docs`) — HWPX 5양식
- **5개 양식**: 1페이지 보고서 / 풀버전 보고서 / 시행문 / **보도자료(자사 표준 신규 제작)** / 이메일(텍스트). 양식 선택 → 참고 파일 첨부(선택) → 지시문 입력 → **한글(HWPX) 파일 다운로드** + 본문 미리보기.
- **파이프라인**: LLM이 양식별 JSON 생성(zod 검증 + 실패 시 1회 재시도) → `tools/hwpx`의 python 파이프라인(표준라이브러리 전용)으로 HWPX 빌드. 1p·풀버전·시행문은 내장 표준 hwpx 베이스(`compose_doc.py`, 개조식·적/의/것/들 자동 최적화 포함), 보도자료는 자사 실배포본(★260327)을 스켈레톤으로 **머리표·제목·부제·□/○ 본문 텍스트만 치환**(`press_builder.py` — 서식 100% 보존, 곡선따옴표 정규화·매수 자동 산정·인용문 조립).
- **컨텍스트 업로드(참고자료)**: txt·md·hwp·hwpx·pdf·docx·xlsx 첨부 시 kordoc으로 추출해 문서에 반영(파일당 **20MB**). **스캔(이미지) PDF는 "OCR로 읽기" 동의 버튼** → RapidOCR(앞 40쪽)로 인식 — 실패 사유도 UI에 그대로 표시.
- 모든 생성은 가드레일 경유(panel:"docs"), hwpx는 한컴오피스 호환 후처리(`fix_namespaces`)·구조 검증을 거쳐 응답.
- **AI 사이드챗**(`/api/ai/chat`) — 멀티턴 + 사규 우선·일반지식 보완 라우팅:
  - 사규 근거는 지식검색 **빠른검색과 동일 파이프라인**(`regulations-search.ts` 공유). 짧은 후속질문은 직전 질문과 결합 검색.
  - **대용량 첨부 인덱싱**(`/api/ai/chat/attach`): 업로드 1회에 전문 추출→가드 **전수검사**→(대형 ≤30만자) 청킹+임베딩, TTL 24h 캐시 → 턴마다 **질문 맞춤 발췌**(요약형 질문은 문서 전체 구조 스킴). 스캔 PDF는 OCR 동의 버튼(앞 60쪽).
  - **입력 게이트(8,000자)는 타이핑만 검사** — 첨부·멀티턴 누적이 게이트에 막히지 않음(첨부는 업로드 시 전수검사, 12메시지 초과분은 롤링 요약). UI: 입력 예산 미터·"📎 N자 중 M자·k구간 반영" 배지·413 행동 유도.

### ⑥ 스마트 안전관리 (`/panel/safety`)
- **자연어 + 사진 멀티모달 진단**: 현장 사진을 첨부하면 위험요소를 식별하고 관련 안전수칙·근거를 안내(`POST /api/safety/chat`). **안전 Q&A 107건**(`src/data/safety/safety-qa.json`)을 키워드검색해 근거로 주입(`lib/safety-rag.ts`), FAQ는 랜덤 카드로 노출.
- 안전 부속 페이지(뉴스·자료실·아티클)와 연계.

### ⑦ AI 민원답변 (`/panel/cs-answer`)
- 접수된 민원을 입력하면 **어조(표준/공감/간결)**를 선택해 답변 초안 생성(`POST /api/cs/answer`). **2024·2025 전사 VOC 집계**(`src/data/cs/voc-aggregates.json`)를 근거로 반복성·빈도를 수치와 함께 진단하고 **공식 답변양식**으로 출력(`lib/cs/voc-analytics.ts`). 접수채널 입력은 제거.
- 반드시 **5단계 구조**(사과·유감 → 공감 → 사실 확인 → 조치 안내 → 마무리)를 따르며, 불확실한 사실은 단정하지 않고 과장 약속을 배제.

### ⑧ AI 광고도안심의 (`/panel/ad-review`)
- 광고 도안 이미지를 업로드하면 **4개 분야**로 멀티모달 점검(`POST /api/ad/review`). 업종 선택 시 업종별 룰셋(`AdIndustryRule`)과 심의기준·금지목록(`AdReviewCriteria`)을 프롬프트에 주입.
- **무저장 원칙**: 도안 이미지를 DB·디스크에 저장하지 않으며, 감사 로그에도 이미지 base64를 기록하지 않습니다(텍스트 사유만 기록, `Cache-Control: no-store`).
- 게재 가부를 단정하지 않고 담당자 판단이 필요함을 안내.

### ⑨ AI 리서치매거진 (`/panel/magazine`)
- 사내 AI 리서치 허브(InsightHub)를 소개하는 매거진형 화면. 외부 표기용 URL(폐쇄망 예외) 1건을 제외하면 외부 호출 없음.

### 관리자 통합 대시보드 (`/admin`, 암호키 인증)
메인에 노출되지 않으며, 매표소 5연속 클릭 또는 직접 URL로 진입 후 `ADMIN_ACCESS_KEY`(8자 이상)로 인증합니다. **접속 IP 제한**(설정탭/`ADMIN_ALLOWED_IPS`) 시에도 **localhost는 항상 허용**(잠금 복구경로). 탭:

| 탭 | 기능 |
|----|------|
| 사용통계 | 기능별·일별 사용량 막대 차트 (`FeatureUsage` 집계, `GET /api/admin/usage?days=`) |
| 가드레일 | 차단 추세·룰/패널 분포·최근 로그 + 런타임 제어판 (기존 GuardrailDashboardClient 이식) |
| 검색품질 | 지식검색 피드백 + 사용 채널(키워드/의미/그래프) 집계 |
| 퀴즈 관리 | 문제 CRUD(`/api/quiz/pool`) + 랭킹 초기화(`DELETE /api/quiz/ranking`) |
| 라이브러리 관리 | 게시물 고정/삭제(`/api/library/[id]`) + 인기 산정 설정(`/api/admin/playground-config`) |
| 기준데이터 | 사규 목록/삭제 + 광고룰셋 목록/삭제 + 심의기준·금지목록 편집 |
| **사규 적재** | 개정본 업로드 → 변경 4분류(실질/명칭/마커/표기차)·조문 인라인 diff 검수 → 교체 적재(시행일·연번 자동, 임베딩·그래프 **증분 갱신**) |
| 문서양식 | 문서작성 HWPX 표준양식 템플릿 관리 |
| 설정 | LLM·임베딩 서버/모델 · 의미/그래프 검색 on·off · 업로드 제한 · **관리자 접속 IP 제한**(env ∪ DB, IPv4 CIDR) · 암호키 안내·로그아웃 |

---

## API 개요

> 모든 LLM 호출은 가드레일 게이트웨이(`guardedChat`/`guardedStreamChat`)를 경유합니다 — 입력 검사·출력 마스킹·감사 로그가 자동 적용됩니다. 차단 시 `GuardBlockedError`의 `block.status`(예: 인젝션/PII 입력 **422**, 악성 출력 **502**)로 응답합니다.

### 상태 확인
| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/health` | GET | 헬스 체크 |
| `/api/ai/status` | GET | 내부 LLM 가용성(`llmConfigured`·모드·ping) |
| `/api/db/status` | GET | DB 연결 & 컬렉션별 문서 수 |

### AI 기능
| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/knowledge/assistant` | POST | 지식검색 어시스턴트(사규 RAG + LLM). `stream: true` 시 SSE(`meta`·`delta`·`done`·`error`) |
| `/api/knowledge/regulations/search` | POST | 사규 텍스트 검색(`$text` + 정규식) |
| `/api/knowledge/regulations/count` | GET | 사규 문서 수 |
| `/api/knowledge/regulations/[id]` | GET | 사규 단건(조문 포함) |
| `/api/sales/diagnosis` | GET | 매장 진단 코멘트 |
| `/api/safety/chat` | POST | 안전 챗봇(텍스트 + **멀티모달 이미지** 진단) |
| `/api/safety/articles` | GET | 안전 아티클 |
| `/api/cs/answer` | POST | 민원 답변 초안(`content`·`tone`) |
| `/api/docs/generate` | POST | 문서 생성(multipart: `format`(1p\|full\|gongmun\|email\|press)·`instruction`·`files[]`) — hwpx 바이너리(또는 `Accept: application/json` 시 base64+미리보기), email은 텍스트 |
| `/api/ad/review` | POST | 광고 도안 4분야 심의(`imageBase64`·`mediaType`·`industry?`, **무저장**) |
| `/api/ad/industries` | GET | 광고 업종 목록 |
| `/api/ai/chat` | POST | 내부 LLM 범용 채팅 |

### 게이미피케이션·콘텐츠
| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/quiz/next` | GET | 다음 퀴즈 문항 |
| `/api/quiz/pool` | GET, POST | 문제 풀 조회(admin)/추가 |
| `/api/quiz/pool/[id]` | DELETE | 문제 삭제(admin) |
| `/api/quiz/ranking` | GET, POST, DELETE | 랭킹 조회 / 점수 등록 / 초기화(admin) |
| `/api/library` | GET, POST | 게시물 목록(`board=`)/등록 |
| `/api/library/[id]` | GET, PATCH, DELETE | 상세 / 수정·고정 / 삭제 |
| `/api/library/[id]/vote` | POST | 좋아요·싫어요(중복 방지) |
| `/api/library/popular` | GET | 인기 게시물(운영 설정 기준 산정) |

### 관리자 (인증: `requireAdmin`)
| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/admin/auth` | POST, DELETE | 관리자 로그인(암호키)/로그아웃 |
| `/api/admin/usage` | GET | 사용량 집계(`days=`) |
| `/api/admin/playground-config` | GET, PATCH | 운영 설정(인기 산정·퀴즈 제한시간) |
| `/api/admin/regulations` | GET, POST | 사규 목록/등록 |
| `/api/admin/regulations/[id]` | GET, PATCH, DELETE | 사규 상세/수정/삭제 |
| `/api/admin/ad-rules` | GET, POST | 광고 업종 룰셋 목록/추가 |
| `/api/admin/ad-rules/[id]` | PATCH, DELETE | 룰 수정/삭제 |
| `/api/admin/ad-criteria` | GET, PUT | 심의기준·금지목록 조회/저장 |
| `/api/admin/guardrails/stats` | GET | 가드레일 통계 집계 |
| `/api/admin/guardrails/logs` | GET | 감사 로그 조회 |
| `/api/admin/guardrails/config` | GET, PUT | 가드레일 런타임 설정 |

### 세션 (레거시)
| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/auth/login` · `/logout` · `/me` | POST/GET | 구 임직원 세션 API(현 메인 동선은 무인증) |

---

## 데이터 모델

총 22개 Mongoose 모델. 주요 모델의 핵심 필드는 다음과 같습니다.

### Playground 기능 모델
| 모델 (컬렉션) | 핵심 필드 | 설명 |
|------|----------|------|
| **QuizPool** | `question`·`choices[]`·`answerIndex`·`explanation` | 서바이벌 퀴즈 문제 풀 |
| **QuizRanking** | `nickname`·`score`·`comboMax`·`playedAt` | 퀴즈 랭킹 기록(닉네임 기반) |
| **LibraryPost** | `board`·`title`·`content`·`usage`·`author`·`thumbnailUrl`·`fileUrl`·`fileName`·`fileSize`·`up`·`down`·`voters[]`·`pinned` | 라이브러리 게시물(3게시판 공용) |
| **PlaygroundConfig** | `key`·`popularWindowDays`·`popularMinLikes`·`popularCount`·`quizTimeLimitSec`·`updatedBy` | 운영 설정(싱글톤, 30초 캐시) |
| **FeatureUsage** | `feature`·`action`·`day`(YYYY-MM-DD)·`count` | 기능 사용량 일별 카운터(`{feature,action,day}` unique) |

### 사규·광고심의 기준 모델
| 모델 (컬렉션) | 핵심 필드 | 설명 |
|------|----------|------|
| **RagRegulation** (`rag_regulation`) | `title`·`content`(pre-save 훅이 자동 생성)·`year`(시행일)·`category`(분류)·`docNumber`(제N호)·`views`(조회수)·`articles[{name,fullText,order,page}]`·`metadata`·`embedding` | 사규(조문 단위). `embedding`은 항상 `null`로 저장(검색 미사용, 향후 벡터 검색 예약) |
| **AdIndustryRule** | `industry`·`category`·`highRisk`·`banned`·`basis`·`riskExpressions[]`·`requiredNotices[]`·`attachments[]`·`rejections[]`·`note`·`sortOrder` | 광고 업종별 심의 룰셋 |
| **AdReviewCriteria** | `key`·`criteriaText`·`prohibitedList[]`·`updatedBy` | 공통 심의기준·금지광고 목록(싱글톤) |

### 가드레일 모델 (M09·M13·M14)
| 모델 (컬렉션) | 설명 |
|------|------|
| **AuditLog** (`auditlogs`) | LLM 입·출력 감사 로그 — `outcome`(pass/blocked/error)·stage·ruleId·panel·마스킹 타입·지연 |
| **GuardConfig** (`guardconfigs`) | 가드레일 런타임 설정(싱글톤) — 기능 on/off·임계치·PII 차단 대상 |
| **GuardRateLimit** (`guardratelimits`) | rate limit 카운터 — TTL 인덱스로 윈도우 만료 시 자동 삭제 |

### 레거시 모델 (AX Portal 잔존, 일부 기능에서 참조)
`User`·`Notice`·`QuizLog`·`PointLog`·`Prompt`·`Resource`·`SafetyArticle`·`VocItem`·`LawConsult`·`PressRelease`·`SalesOrder` — 구 업무 포털 기능에서 유래. 현재도 일부 보조 화면/시드에서 참조되어 보존합니다.

---

## 화면·컴포넌트 구성

| 영역 | 컴포넌트 | 설명 |
|------|----------|------|
| **메인맵** | `playground/PlaygroundHome.tsx` | 메인 셸 — 인트로 배너·중앙 리더보드 전광판·놀이공원 맵 배치 |
| | `playground/MainMap.tsx` | 레이어형 이미지맵 — 건물 이미지·항상표기 라벨·클릭 핫스팟(겹침 없는 정밀 배치) |
| **기능 패널** | `panels/desktop/PanelLaw.tsx` | 지식검색(RAG 검색 + 출처 팝업 + SSE 스트림) |
| | `panels/desktop/PanelSalesHub·Upload·Trend.tsx` | 매출분석 허브 + 편의점 매출 비교(엑셀·AI진단) + 업종별 트렌드(전사·역별·전문점 드릴다운·예측) |
| | `panels/desktop/PanelSafety.tsx` | 안전(자연어 + 사진 멀티모달 진단) |
| | `panels/desktop/PanelCsAnswer.tsx` | 민원답변(어조 선택·5단계 초안) |
| | `panels/desktop/PanelAdReview.tsx` | 광고도안 심의(이미지 업로드·4분야 결과) |
| | `panels/desktop/PanelMagazine.tsx` | 리서치매거진(InsightHub 소개) |
| **관리자** | `admin/AdminDashboard.tsx` | 6탭 프레임(`?tab=`으로 초기 탭 지정) |
| | `admin/AdminKeyGate.tsx` | 암호키 입력 게이트 |
| | `admin/tabs/*ManageTab.tsx` | Usage·Quiz·Library·Data·Settings 탭 본체 |
| | `app/admin/guardrails/GuardrailDashboardClient.tsx` | 가드레일 탭 본체 |

메인맵의 건물·기능 정의(번호·라벨·경로·핫스팟)는 `lib/playground-map.ts`에 단일 소스로 모여 있습니다.

---

## 시작하기

### 요구사항
- Node.js 18+
- MongoDB (로컬 또는 호스팅 인스턴스)
- 내부 LLM (OpenAI 호환 API, **멀티모달/비전 지원** 모델 권장 — 안전 사진 진단·광고 심의)
- 사규 RAG 검색은 MongoDB `$text` 전문검색 기반이라 **임베딩 모델 설정이 필요 없습니다**(`OLLAMA_EMBEDDING_*`는 예약 변수).

### 설치 및 실행

```bash
git clone <레포지토리>
cd <레포>/ax-portal

# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env.local
# .env.local에 필수 값 입력 (아래 [환경 변수])

# 개발 서버 실행
PORT=3200 npm run dev
# http://localhost:3200 접속
```

### 초기 데이터 시드

```bash
# 사규 임포트 (data/regulations-2026의 HWP/PDF/md → 조문 단위 저장, embedding은 null)
# --dry-run으로 미리보기, --commit으로 실제 반영, --sagyu로 sagyu.json 동시 생성
npx tsx src/scripts/import-regulations.ts --commit
# (레거시: npm run seed:regulations / seed:regulations:txt — 구 TXT 방식)

# 광고심의 룰셋 시드 (업종 룰 + 심의기준·금지목록)
npm run seed:ad-rules

# 퀴즈 시드
npx tsx src/scripts/seed-quiz-survival.ts

# 기타 기본 데이터 (공지·프롬프트 등 레거시 시드)
npm run seed

# DB 상태 확인
npm run db:status
```

관리자(`/admin` → 기준데이터 탭)에서도 사규·광고룰셋을 직접 등록·수정·삭제할 수 있습니다.

---

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `MONGODB_URI` | **필수** | MongoDB 연결 문자열(폐쇄망 로컬 예: `mongodb://127.0.0.1:27017/axplayground`) |
| `SESSION_SECRET` | **필수** | iron-session 암호화 키(32자 이상) |
| `OPENAI_COMPATIBLE_BASE_URL` | **AI 기능** | 내부 LLM(OpenAI 호환) Base URL (예: MLX-VLM `http://127.0.0.1:8080/v1`, Ollama `http://127.0.0.1:11434/v1`) |
| `OPENAI_COMPATIBLE_MODEL` | **AI 기능** | 모델명(예: `mlx-community/gemma-4-e2b-it-4bit`) — 멀티모달 기능엔 비전 모델 |
| `OPENAI_COMPATIBLE_API_KEY` | 선택 | 호환 서버용 키(로컬은 `ollama` 등 placeholder 가능) |
| `ADMIN_ACCESS_KEY` | **관리자** | 관리자 진입 암호키(8자 이상) |
| `UPLOAD_DIR` | 선택 | 라이브러리 업로드 저장 경로(기본 `public/uploads`) |
| `OLLAMA_EMBEDDING_MODEL` | 미사용(예약) | Ollama 임베딩 모델명. **현재 사규 검색에 미사용**, 향후 벡터 검색 대비 예약 |
| `OLLAMA_EMBEDDING_BASE_URL` | 미사용(예약) | Ollama API URL(기본 `http://127.0.0.1:11434`). 현재 미사용 |
| `EMBEDDING_DIMENSIONS` | 미사용(예약) | 임베딩 차원(미설정 시 768). 현재 미사용 |
| `NEXT_PUBLIC_BASE_URL` | 선택 | 프론트엔드 베이스 URL |
| `LAW_API_OC` | 선택 | 법제처 Open API 기관 코드 |
| `AUDIT_LOG_FILE` | 선택 | 가드레일 감사 로그 파일 경로(기본 `/var/log/axp-audit.log`) |
| `AUDIT_LOG_FULL_TEXT` | 선택 | 감사 로그에 입·출력 전문 기록(`false`면 메타만, 기본 true) |

### .env.local 예시

```env
MONGODB_URI=mongodb://127.0.0.1:27017/axplayground
SESSION_SECRET=여기에_32자_이상의_랜덤_문자열을_입력하세요

# 내부 LLM (OpenAI 호환, 멀티모달) — 모든 생성 기능
OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:8080/v1
OPENAI_COMPATIBLE_MODEL=mlx-community/gemma-4-e2b-it-4bit
OPENAI_COMPATIBLE_API_KEY=ollama

# 관리자 진입
ADMIN_ACCESS_KEY=여기에_8자_이상의_관리자_암호키

# 업로드 저장 경로(선택)
# UPLOAD_DIR=public/uploads

# 사규 검색은 $text 전문검색이라 아래 임베딩 변수는 현재 미사용(예약)
# OLLAMA_EMBEDDING_MODEL=nomic-embed-text

NEXT_PUBLIC_BASE_URL=http://localhost:3200
```

---

## 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버(`PORT`로 포트 지정) |
| `npm run build` | sagyu.json 생성 + Next.js 빌드 |
| `npm run start` | 프로덕션 서버 |
| `npm run lint` | ESLint |
| `npm run seed` | 기본 데이터 시드(레거시 포함) |
| `npx tsx src/scripts/import-regulations.ts` | **현행 사규 임포트** — `data/regulations-2026`의 HWP/PDF/md를 조문 단위로 저장(embedding은 null). `--dry-run`(미리보기)·`--commit`(반영)·`--sagyu`(sagyu.json 동시 생성). `npm run build`가 `--sagyu`를 수행 |
| `npm run seed:regulations` | (레거시) 구 TXT 파싱 사규 시드 |
| `npm run seed:regulations:txt` | (레거시) TXT 파일에서 사규 시드(대체 경로) |
| `npm run seed:ad-rules` | 광고심의 업종 룰셋 + 심의기준 시드 |
| `npm run db:status` | DB 연결 및 컬렉션별 문서 수 확인 |
| `npm run test:guardrails` | 가드레일 단위 테스트(PII·인젝션/시크릿·시스템프롬프트) |
| `npm run report:audit` | 가드레일 감사 로그 일일 리포트(cron 권장) |
| `npm run fix:regulations-index` | 사규 텍스트 인덱스 보정 |
| `npm run migrate:rag-regulation` / `migrate:articles` | 레거시 사규 → RagRegulation / content → articles 마이그레이션 |
| `npm run reembed:regulations` | **현재 no-op**(임베딩 미사용 — 재반영은 `import-regulations.ts --commit`) |
| `npm run check:embedding-dims` | 임베딩 차원 점검(예약) |

> 퀴즈/프롬프트 보강 시드는 `src/scripts/seed-quiz-survival.ts`·`seed-quiz-pool-2nd.ts`·`seed-prompts-2nd.ts`를 `npx tsx`로 직접 실행합니다.

---

## 사규 RAG 파이프라인

### 개요
기관 내부 사규(6분류)를 조문 단위로 MongoDB에 저장하고, **MongoDB `$text` 전문검색 + 정규식 키워드 매칭**으로 검색하여, 지식검색 패널에서 관련 사규를 자동으로 찾아 답변 근거로 인용합니다. (현재 벡터·임베딩·코사인 유사도는 사용하지 않으며, `embedding` 필드는 `null`로 저장됩니다. 향후 벡터 검색은 to-be 과제입니다.)

실제 회수 로직은 `src/lib/regulations-retrieve.ts`이며, `knowledge/assistant`·`knowledge/regulations/search`가 이를 호출합니다. 전처리·파싱·조문 추출은 `regulations-parse.ts`·`regulations-preprocess.ts`·`regulations-articles.ts`·`regulations-content.ts`가 담당합니다.

### 데이터 흐름

```
사규 원본 (data/regulations-2026/, 6분류: 규정·세칙·지침·매뉴얼·편람·계약서 — HWP/PDF/md)
    │  npx tsx src/scripts/import-regulations.ts (--dry-run/--commit/--sagyu)
    │  (텍스트 추출 → 문서/조항 파싱 → 조문 추출, embedding은 null로 저장)
    ▼
MongoDB (rag_regulation 컬렉션 — 문서 단위 저장, 분류 6종)
    │  title + content + articles[{name, fullText, order, page}]  (embedding: null)
    ▼
지식검색 패널에서 검색/인용 (retrieveRagRegulationsForQa)
    - $text 전문검색: title/content/articles의 text 인덱스 → textScore 랭킹
    - 정규식 키워드 매칭: 키워드를 title/content/articles에 RegExp 매칭, 점수 가산
    - 위 둘을 합산해 랭킹 (벡터·코사인·임베딩 미사용)
    - 클라이언트 검색: sagyu.json (빌드 시 자동 생성, 텍스트 필터링)
```

### TXT 파일 형식

```
[문서명] 취업 규칙(2025년도 9월 개정)
[처리일] 2026. 2. 19.
[총페이지] 38
============================================================
제 1 조 ( 목적 )
이 규칙은 ○○기관...
```

---

## LLM 가드레일

모든 LLM 호출은 `src/lib/guardrails/`의 게이트웨이(`guardedChat`/`guardedStreamChat`)를 반드시 경유합니다. 근거: 국가·공공기관 AI보안 가이드북 v2.0(M09·M13·M14·M15·M16·M27). 상세 통제 매핑: `docs/guardrail-mapping.md`.

### 3단계 다중 방어
```
[입력 가드]  길이 제한 → rate limit → 프롬프트 인젝션/탈옥 차단(M14) → 고위험 PII 차단(M13)
     │         (input/length.ts · input/ratelimit.ts · input/injection.ts · input/pii.ts)
     ▼
[모델 제어]  보안 프리앰블 + 패널 역할을 system 프롬프트에 강제 주입(M15)
     │         (model/system-prompt.ts)
     ▼
[출력 가드]  악성코드 패턴 차단(M13) → 자격증명·내부IP 마스킹 → PII 마스킹(M13)
     │         (output/secrets.ts · output/pii-mask.ts)
     ▼
[감사 로그]  pass/blocked/error 모두 기록(M09) — 파일 + MongoDB(AuditLog)
              (output/audit.ts)
```

### 핵심 동작
- **차단 응답**: 입력 인젝션·고위험 PII는 **HTTP 422**, 악성 출력은 **502**로 응답(`GuardBlock.status`). 라우트는 `isGuardBlockedError`로 분기.
- **스트리밍 보호**: SSE 출력도 청크별로 PII/시크릿을 마스킹하되, PII가 청크 경계를 가로지르는 경우 안전 꼬리(`SAFE_TAIL`)만큼 버퍼에 보류해 누락을 방지.
- **멀티모달 프리앰블**(중요): 작은 멀티모달 모델은 강한 텍스트 방어 프리앰블이 있으면 **첨부 이미지를 무시**하는 경향이 있습니다. 이를 피하기 위해 이미지 첨부 호출(`image_url` 감지)에는 **경량 보안 프리앰블**(`MULTIMODAL_SECURITY_PREAMBLE`)을 자동 적용 — 이미지 인식을 보장하면서 핵심 보안(개인정보 생성·내부정보·자격증명 노출 금지)은 유지합니다. (`guardedChat`이 자동 판별)
- **입력 검사 범위**: `guardInput`으로 실제 사용자 입력만 지정 가능 — 신뢰 가능한 RAG 컨텍스트·system 프리앰블을 인젝션 룰이 자기-오탐하는 것을 방지.
- **런타임 제어**: 관리자 가드레일 탭에서 7종 가드 on/off·임계치·PII 차단 대상을 즉시 조정(`GuardConfig`, 30초 캐시 + 저장 시 무효화).

### 테스트
```bash
npm run test:guardrails   # PII · 인젝션/시크릿 · 시스템 프롬프트 단위 테스트
```

---

## 로컬 MongoDB 스냅샷

`data/mongo-snapshot/`에 **mongodump** 결과를 포함해 둘 수 있습니다. 다른 PC에서 동일한 개발 DB를 복원할 때 사용합니다.

- 복원 순서·주의사항은 해당 폴더의 `README.md`를 참고하세요(`mongorestore` 예시는 저장소 루트에서 실행 가정).
- 덤프에는 개발용 샘플 데이터가 포함될 수 있습니다. `SESSION_SECRET`·API 키 등은 BSON에 포함되지 않습니다.

---

## 라우팅·접근 정책

`src/middleware.ts`는 **레거시 경로 리다이렉트**만 담당하며(`/login`·`/setup` 등 → 메인), 일반 임직원 동선은 **무인증**입니다. 보호가 필요한 영역은 라우트 레벨에서 처리합니다.

- **관리자 보호**: `/admin` 페이지와 `/api/admin/*` 라우트는 `lib/adminAuth.ts`의 `requireAdmin`/`isAdmin`으로 검증(`ADMIN_ACCESS_KEY` 기반 iron-session). 비인증 시 API는 401, 페이지는 암호키 게이트 표시.
- **관리자 진입점 은닉**: `/admin` 링크는 메인 GUI에 노출하지 않으며, 매표소 5연속 클릭(히든) 또는 직접 URL로만 진입.
- **광고 심의 무저장**: `/api/ad/review`는 이미지를 저장하지 않고 `Cache-Control: no-store`로 응답.

---

## 핵심 라이브러리

| 파일 | 설명 |
|------|------|
| `lib/llm.ts` | 내부 LLM(OpenAI 호환) `chat.completions` — `chatLlm`·`streamChatLlm`(스트림 델타), **멀티모달 content 지원**, `temperature`/`maxTokens`/`system` 옵션 |
| `lib/guardrails/` | LLM 가드레일 게이트웨이 — `guardedChat()`/`guardedStreamChat()`, 입력/모델/출력 검사 + 감사 로그 + 런타임 설정 |
| `lib/playground-map.ts` | 메인 이미지맵의 건물·기능 정의(번호·라벨·경로·핫스팟) 단일 소스 |
| `lib/playgroundConfig.ts` | 운영 설정 로더(`PlaygroundConfig`) — 인기 산정·퀴즈 제한시간, 30초 캐시 + 무효화 |
| `lib/ad-rules.ts` · `lib/ad-review.ts` | 광고 업종 룰셋·심의기준 로더(캐시) + 4분야 심의 프롬프트 빌드·결과 파싱 |
| `lib/usage.ts` | 기능 사용량 집계(`FeatureUsage`) — `recordUsage()`(fire-and-forget) + `getUsageSummary()` |
| `lib/docs-generate.ts` | AI 문서작성 — 양식별 zod 스키마·시스템 프롬프트·compose 입력(md+meta) 변환·미리보기 렌더 |
| `lib/regulations-retrieve.ts` 외 `regulations-*` | 사규 RAG 회수·파싱·전처리·조문 추출 |
| `lib/adminAuth.ts` | 관리자 인증(`requireAdmin`/`isAdmin`) |
| `lib/upload.ts` | 라이브러리 썸네일·자료 파일 저장(`UPLOAD_DIR`) |
| `lib/quiz.ts` · `lib/nickname.ts` · `lib/voterId.ts` · `lib/sfx.ts` · `lib/imeEnter.ts` | 퀴즈 출제·닉네임 생성·투표자 식별·효과음·IME 엔터 처리 |
| `lib/db.ts` | MongoDB 연결(전역 캐시, 풀링) |
| `lib/session.ts` | iron-session 래퍼(관리자 세션) |
| `lib/env.ts` | 환경 변수 정의·검증 |
| `lib/embedding.ts` | Ollama 임베딩 래퍼 — **현재 미호출(비활성)**, 향후 벡터 검색 대비 보존 |
| `lib/points.ts` · `lib/date.ts` | 포인트·KST 날짜 유틸 |

---

## 추가 문서

- **가드레일 통제 매핑**: `docs/guardrail-mapping.md` — 가이드북 ID ↔ 구현(감리 대응)
- **시스템·가드레일 통합 구조도**: `docs/AX_Portal_통합_시스템_가드레일_구조도.html`
- 그 외 `docs/`에 MongoDB 스키마·폐쇄망 설치·운영 가이드 등 문서 다수

---

## 라이선스

MIT — 루트 [`LICENSE`](../LICENSE) 참조.
