# CLAUDE.md — 코딩 에이전트용 저장소 안내

이 파일은 Claude Code 등 코딩 에이전트가 이 저장소에서 작업할 때 먼저 읽는 안내입니다.
사람이 읽을 프로젝트 소개·설치·온보딩은 [`README.md`](README.md) 를 보세요.

## 작업 방식

- 코드를 쓰기 전에 관련 파일을 먼저 읽습니다. 경로를 추측하지 않습니다.
- 새로 만들기보다 있는 파일을 고칩니다. 문서 파일은 요청받았을 때만 만듭니다.
- 단순하고 직접적인 해법을 택합니다. 과설계하지 않습니다.
- 확실하지 않으면 확실하지 않다고 말합니다.
- 변경 후에는 최소한 `npm run lint` 와 관련 테스트를 돌려 확인합니다.

## 이 프로젝트가 지켜야 하는 제약

1. **외부 네트워크 호출 금지.** 운영 환경은 인터넷이 차단된 폐쇄망입니다. 런타임 코드에 외부
   SaaS·CDN·API를 추가하지 마세요. 폰트·wasm·모델 등 자산은 저장소에 동봉하거나 오프라인 번들로
   반입합니다. 예외는 명시적으로 "인터넷 되는 개발망 전용"이라고 표시된 수집 스크립트뿐입니다
   (`src/scripts/fetch-external-laws.mjs` 등).
2. **모든 LLM 호출은 가드레일을 지납니다.** `src/lib/guardrails`(입력 검사 → 모델 → 출력 검사 →
   감사로그)를 우회해 모델 클라이언트를 직접 부르지 마세요.
3. **무로그인 전제.** 일반 사용자 화면에 인증을 넣지 않습니다. 관리자 화면(`/admin`)만
   `ADMIN_ACCESS_KEY` + iron-session 으로 보호합니다.
4. **개인정보·업로드물 최소 보관.** 매출 엑셀·광고 도안 등은 서버에 저장하지 않는 흐름입니다.
   저장이 필요한 변경은 먼저 근거를 밝히세요.

## 구조 빠른 지도

| 경로 | 내용 |
|------|------|
| `src/app/` | 페이지 + API 라우트(`src/app/api/**`) |
| `src/components/panels/` | 기능 패널 UI (`desktop/` 데스크톱, 패널별 하위 폴더) |
| `src/lib/guardrails/` | 입력·출력 검사, PII/시크릿 마스킹, 감사로그 |
| `src/lib/llm.ts` · `src/lib/env.ts` | 모델 클라이언트 · 환경변수 스키마 |
| `src/lib/regulations*.ts` | 사규 RAG(적재·청킹·검색·sagyu.json 생성) |
| `src/lib/docs-generate.ts` · `tools/hwpx/` | 문서 생성 파이프라인 · HWPX 빌더(순수 Python stdlib) |
| `src/models/` | Mongoose 스키마 = MongoDB 컬렉션 |
| `src/scripts/` | 적재·시드·평가 스크립트(`tsx`로 실행) |
| `data/regulations-2026/` | 사규 원본 md(샘플 4건) — 폴더 이름이 곧 분류 |
| `docs/` | 아키텍처·설치·RAG·가드레일 문서 |

## 설정이 읽히는 순서

관리자 화면에서 저장한 DB 설정(`playground_config`)이 **환경변수보다 우선**하고, 환경변수는 폴백입니다.
관리자 설정에 **필드를 새로 추가할 때**는 Mongoose strict 모드가 저장 시점에 미지의 필드를 잘라내므로,
스키마·타입 변환·저장 API(`findOneAndUpdate` 의 `strict: false`)·프런트 기본값을 한 세트로 함께 고치세요.

## 개발 명령

```bash
npm run dev              # http://localhost:3000
npm run lint
npm run test:guardrails  # 가드레일 단위 테스트
npm run build            # 사규 JSON 생성 + next build
```

DB는 `docker compose up -d` 로 로컬 MongoDB를 띄우면 됩니다. **빈 DB로도 앱이 뜹니다** — 초기 데이터
적재 절차는 README의 "초기 데이터 온보딩" 절을 따르세요.

## 문서 참조

동작 구조는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), 기능·화면 상세는
[`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md), 사규 검색 파이프라인은
[`docs/RAG_GRAPHRAG.md`](docs/RAG_GRAPHRAG.md), 폐쇄망 설치는
[`docs/OFFLINE_INSTALL.md`](docs/OFFLINE_INSTALL.md) 에 있습니다.
