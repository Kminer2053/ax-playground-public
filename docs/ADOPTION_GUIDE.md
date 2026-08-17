# 타기관 도입 가이드 — 우리 기관의 AX Playground 만들기

이 문서는 **다른 기관의 AX 담당자**가 이 저장소를 가져다 자기 기관의
"AX 플레이그라운드"를 만드는 전 과정을 순서대로 안내합니다.
따라 하기만 하면 됩니다 — 코드 수정이 필요한 항목은 § 5-2에 체크리스트로 따로 모았습니다.

> 이 플랫폼의 뼈대는 **핵심 4기능**(① AI 리터러시 리더보드 ② AX 라이브러리 ③ AI 지식검색(RAG)
> ④ AI 문서작성)입니다. 나머지 건물 5개(매출분석·안전관리·민원답변·광고심의·리서치매거진)는
> **관리자 화면에서 이름을 바꾸고, 기관 자체 웹앱을 연계하거나 숨길 수 있는 확장 슬롯**입니다.

## 0. 도입 로드맵

| 단계 | 내용 | 수행자 | 소요(참고) |
|---|---|---|---|
| 1 | 인프라 준비 — 서버·MongoDB·LLM | 시스템 담당 | 0.5~1일 |
| 2 | 설치(개발망 또는 폐쇄망 반입) | 시스템 담당 | 0.5~2일 |
| 3 | 관리자 기본 설정 — LLM 연결·임베딩 | AX 담당 | 1시간 |
| 4 | 데이터 적재 — 내부규정·퀴즈·심의기준 | AX 담당 + 현업 | 1~5일(데이터 준비에 좌우) |
| 5 | 기관 커스터마이징 — 브랜딩·건물 구성 | AX 담당 (+개발자 일부) | 0.5~1일 |
| 6 | 보안·감리 검토, 오픈 | 보안 담당 | 기관 절차에 따름 |

## 1. 준비물 (인프라)

| 구성요소 | 요건 | 비고 |
|---|---|---|
| **앱 서버** | Ubuntu 24.04(권장, WSL2 포함) 또는 Windows · Node 22+ | 앱 자체는 경량 — LLM이 별도 서버면 4C/8GB로도 충분 |
| **MongoDB** | Community Edition(**무료**) 7.x | 동봉된 `docker compose up -d` 한 줄이면 됨. Atlas 등 유료 서비스 불필요 |
| **LLM 서버** | OpenAI 호환 API(Ollama·vLLM·MLX 등) | **필수.** 스마트 안전관리·광고도안심의를 쓰려면 **비전(멀티모달) 모델** 필요 |
| **임베딩 서버** | Ollama + `bge-m3` 등 | **선택.** 없으면 지식검색이 키워드 검색만으로 동작(의미검색 자동 비활성) |
| **OCR(Python)** | Python 3.12 + RapidOCR(오프라인 휠) | **선택.** 스캔 PDF 컨텍스트·광고심의 OCR용 — [`tools/ocr`](../tools/ocr/README.md) |

외부 SaaS·CDN·API는 일절 쓰지 않으므로 **완전 폐쇄망에서 동작**합니다.

## 2. 설치

- **인터넷 되는 환경(개발·검증)**: 루트 [README의 "빠른 시작"](../README.md#빠른-시작-로컬-개발) —
  `npm i` → `.env.local` 작성(MONGODB_URI·SESSION_SECRET·ADMIN_ACCESS_KEY·LLM 주소) →
  `docker compose up -d` → `npm run dev`.
- **폐쇄망(운영)**: [OFFLINE_INSTALL.md](OFFLINE_INSTALL.md)(Ubuntu/WSL2) ·
  [OFFLINE_INSTALL_WINDOWS.md](OFFLINE_INSTALL_WINDOWS.md) — 연결된 머신에서 번들 조립 → 반입 → 설치.
- **빈 DB로 그대로 뜹니다.** 시드 덤프는 동봉되지 않으며(기관 데이터라 제외 —
  [data/mongo-snapshot/README.md](../data/mongo-snapshot/README.md)), 데이터는 § 4에서 채웁니다.

## 3. 관리자 기본 설정

`/admin` 접속(메인 "메뉴" 모드의 관리자 타일, 또는 직접 URL) → `ADMIN_ACCESS_KEY` 입력 → **설정** 탭.

1. **LLM 서버**: base URL 입력 → [모델 불러오기] → 기본 모델 선택 → [설정 테스트] — 정상 응답 확인.
2. **기능별 모델**: 기능마다 다른 모델 지정 가능(비전 기능은 비전 모델로).
3. **지식검색 — 의미·그래프**: 임베딩 서버 주소·모델(`bge-m3` 권장)·차원 → [임베딩 테스트].
4. **관리자 암호 변경 + 접속 IP 제한** — 운영 전 필수.

> 관리자 화면에서 저장한 설정(DB)이 **환경변수보다 우선**하고, 환경변수는 폴백입니다.
> 저장 즉시 반영됩니다(30초 캐시).

## 4. 데이터 적재 — 우리 기관 데이터로

| 데이터 | 방법 | 동봉 샘플 | 상세 |
|---|---|---|---|
| **내부규정(사규)** | `/admin › 사규` 업로드(HWP·HWPX·PDF·MD) 또는 `data/regulations-2026/` 방식 폴더 적재 — **폴더명이 곧 분류** | 가상 사규 9건(분류 6종) — `data/regulations-2026/` | [README 온보딩 ②~④](../README.md#초기-데이터-온보딩) · [사규_시드_실행_가이드](사규_시드_실행_가이드.md) · md 규격: [data/regulations-2026/README](../data/regulations-2026/README.md) |
| 퀴즈 문항 | 기본팩 일괄 시드 `npm run seed:quiz` 또는 `/admin › 퀴즈 관리`(엑셀 일괄 업로드) | 기본팩 200문항(기관 중립) `scripts/quiz-seed-data.json` · CSV 형식 예시 20문항 `data/samples/quiz-sample.csv` | 리터러시 리더보드의 출제 풀 |
| 공지 팝업 | `/admin › 설정 › 공지` | — | |
| 광고심의 기준·업종 룰 | `/admin › 광고심의 기준` | `npm run seed:ad-rules`(시연용 기본 룰) | 광고심의 건물을 쓸 때만 |
| 라이브러리 초기 자료 | `/admin › 라이브러리 관리` | `npm run seed:library-sample` | 프롬프트·자료·영상 |
| 문서양식(HWPX) | `/admin › 문서양식` | 표준 양식 동봉(기본 적용) | 문서작성의 표준 양식 |
| 검색 품질 골드셋 | CLI — `npx tsx src/scripts/benchmark.ts` | `data/benchmark/`(20+8문항) | 적재한 사규의 검색 품질 측정 |
| 업무탐색 3D(온톨로지·보드) | `npm run seed:work-sample` (`--dry` 검증만 · `--clean` 샘플 제거) | 가상 조직 샘플(부서·업무 10건·스윔레인 보드) `data/work100/sample/` | 지식검색 패널의 [업무탐색] 3D 화면 — § 4-2 |
| 외부 법령(선택) | 인터넷 머신에서 [법제처 수집 스크립트](../data/laws/README.md) → md만 폐쇄망 반입 → `npm run laws:ingest` | — | 법제처 OC(기관코드) 필요 |

일괄 체험 데이터는 `npm run seed`(데모용)로 넣어볼 수 있습니다.

### 4-1. 동봉 샘플로 30분 만에 끝까지 검증

실데이터를 준비하기 전에, 동봉 샘플만으로 적재 → 검색 → 평가 → 퀴즈 → 문서생성 전 구간을
검증할 수 있습니다. § 3(LLM 연결)까지 마친 상태에서 시작합니다.

1. **샘플 사규 적재** — `npx tsx src/scripts/import-regulations.ts --commit` → `npm run sagyu:build`
2. **지식검색 확인** — `/panel/knowledge` 에서 "연차휴가", "문서 보존기간" 등 질의 →
   답변과 근거 인용(사규 조항)이 뜨는지 확인
3. **벤치마크 실행** — `npx tsx src/scripts/benchmark.ts --label sample` —
   `data/benchmark/` 골드셋(20+8문항)으로 검색 품질 점수 확인
4. **퀴즈 적재** — `npm run seed:quiz`(기본팩 200문항) 또는 `/admin › 퀴즈 관리` 에
   `data/samples/quiz-sample.csv`(CSV 형식 예시 20문항) 업로드 → `/quiz` 에서 풀어보기
5. **문서작성 1건** — `/panel/docs` 에서 보고서 1건 생성 → HWPX 다운로드 확인
6. **업무탐색 3D** — `npm run seed:work-sample` → `/panel/knowledge` 상단 [업무탐색] 토글 →
   3D 업무지도에서 업무 큐브 클릭 → 절차 보드·근거 조문 확인

여기까지 이상이 없으면 앱·LLM·RAG 파이프라인이 모두 정상입니다. 이후 위 표대로 실데이터로 교체하세요.

### 4-2. 업무탐색 3D · 업무100 파이프라인 (선택)

지식검색 패널의 **[업무탐색]** 토글은 조직의 부서→업무→근거 조문을 three.js 3D 업무지도로
탐색하는 화면입니다. 두 단계로 도입합니다.

- **샘플 체험**: `npm run seed:work-sample` — 가상 조직 샘플(`data/work100/sample/work-explore-sample.json`)을
  실파이프라인과 동일한 검증 게이트(매니페스트 검증 + 보드 스키마·구성 감사)로 적재합니다.
  **자기 조직으로 바꿀 때는 이 JSON만 조직 값으로 교체**하면 됩니다(스크립트 수정 불필요).
- **업무100 생성(고급)**: 사규를 적재한 기관은 `src/scripts/gen-work100-tasks.ts → gen-work100-grounds.ts →
  gen-work100-boards.ts` 파이프라인으로 자기 사규 기반 업무 목록·근거·스윔레인 보드를 LLM으로 생성할 수
  있습니다(생성 산출물은 기관 데이터라 미동봉). 보드 렌더러는 `vendor/korea100studio`(스키마 검증·구성
  감사·SVG 렌더 CLI 동봉), 설계 문서는 [WORK100_DESIGN.md](WORK100_DESIGN.md) ·
  [ONTOLOGY.md](ONTOLOGY.md) · [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md)를 보세요.
- **참조 구현(데모)**: 3D 화면의 실행 가능한 사양서가 `data/work100/demo/`에 있고, 조립용 샘플 보드
  SVG(정적+모션)가 `data/work100/sample/boards/`에 동봉돼 있습니다.

## 5. 우리 기관 것으로 바꾸기

### 5-1. 관리자 화면에서 (코드 수정 불필요)

`/admin › 설정`:

- **기관 정보** — 기관명·대표자: 화면 문구·LLM 프롬프트·생성 문서(발신 기관·서명)에 전역
  반영됩니다. 입력 전 폴백은 "우리 기관"(화면·프롬프트)·"○○기관"(생성 문서)입니다.
- **메인 건물(기능) 구성** — 건물별로:
  - **이름·설명 변경**(전 건물, 이름 16자·설명 30자) — 기관 용어에 맞게.
  - **외부 웹앱 URL 연계**(확장 5개 건물) — 설정하면 클릭 시 기관 자체 웹앱이 **새 탭**으로 열립니다.
    예: "AI 매출분석" 건물을 "경영정보 대시보드"로 이름 바꾸고 기관 BI 포털 URL 연계.
  - **숨김**(확장 5개 건물) — 안 쓰는 기능은 메인에서 제거.
  - 핵심 4기능(리더보드·라이브러리·지식검색·문서작성)은 플랫폼 기본기라 연계·숨김이 되지 않습니다.
- **패널 소개 스플래시 — 기여자·배지**: 각 기능 진입 화면에 표시할 기관 내 기여자.

### 5-2. 코드에서 바꿔야 하는 것 (브랜딩 체크리스트)

기관명은 코드에 남아 있지 않습니다 — 화면 문구·LLM 프롬프트·생성 문서에 들어가는 기관명은 전부
**관리자 설정 › 기관 정보**(§ 5-1)에서 주입되므로, 기관명·대표자만 입력하면 자동 반영됩니다.
파일을 직접 수정할 항목은 다음 둘뿐입니다.

- [ ] 브랜드 색상: `src/app/globals.css` 의 `--brand-*` CSS 변수(4종)를 기관 색으로
- [ ] 메인맵 배경 이미지: `public/playground/base-map.png` — 그림 속 워드마크를 기관 것으로 교체(선택)

> 검증: 기관명 grep 잔존 0 — 이 저장소는 이미 달성한 상태로 배포되며, 자기 기관명이 코드에
> 박히지 않게 유지하면 됩니다(기관명은 항상 관리자 설정으로).

## 6. 운영·업데이트

- **사규(RAG) DB만 무중단 교체**: `scripts/update-rag-db.sh` → 관리자 설정 탭의 [RAG 캐시 새로고침]
  — 앱 재시작 없이 반영. 상세: [RAG_GRAPHRAG.md §12](RAG_GRAPHRAG.md)
- **소스 업데이트(폐쇄망)**: git bundle 반입 — [CLOSED_NETWORK_GIT_BUNDLE_SYNC.md](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md) ·
  [CLOSED_NETWORK_LINUX_UPDATE.md](CLOSED_NETWORK_LINUX_UPDATE.md) · [CLOSED_NETWORK_WINDOWS_UPDATE.md](CLOSED_NETWORK_WINDOWS_UPDATE.md)
- **백업**: `mongodump` 스냅샷 — [data/mongo-snapshot/README.md](../data/mongo-snapshot/README.md).
  전체 `--drop` 복원은 관리자 설정까지 덮어쓰니 운영 서버에서는 RAG만 교체하세요.
- **동시 사용자 튜닝**: [README "다중 사용자 운영"](../README.md#다중-사용자-운영동시성)

## 7. 보안·감리 대응 요약

- 모든 LLM 호출은 가드레일 게이트웨이(입력 검사 → 모델 → 출력 검사 → **감사로그**)를 경유 —
  구현·통제 매핑: [guardrail-mapping.md](guardrail-mapping.md) (국가·공공기관 AI보안 가이드북 대응)
- 일반 사용자 무로그인 / 관리자만 암호+IP 제한(+iron-session)
- 매출 엑셀·광고 도안 등 업로드물은 서버에 **저장하지 않는** 흐름
- 외부 네트워크 호출 없음(폰트·wasm·모델 전부 동봉) — 격리 검증: [OFFLINE_INSTALL.md §8](OFFLINE_INSTALL.md)

## 8. 자주 묻는 질문

- **LLM 없이 화면만 볼 수 있나요?** 앱은 뜨지만 AI 기능은 모두 LLM 연결이 필요합니다.
- **임베딩 서버가 없으면?** 지식검색이 키워드 검색만으로 동작합니다(끄고 켜기는 관리자 설정).
- **MongoDB는 꼭 유료인가요?** 아니요 — Community Edition(무료)이며 docker compose가 동봉돼 있습니다.
- **모바일 지원?** 데스크톱 전용(최소 가로 1280px)입니다.
- **라이선스는?** MIT — 단, 원 개발 기관의 명칭·로고 등 상표는 허여 범위에 포함되지 않습니다.
