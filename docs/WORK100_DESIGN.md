# 업무100 전체 설계 (v1)

> **목적**: 부서업무 기반 "업무지식탐색(무한성)"을 AI지식검색의 기본 화면으로 통합하는 실서비스 설계.
> 확정 자산 위에서 설계한다: 온톨로지 v0([ONTOLOGY.md](ONTOLOGY.md)·`data/ontology/manifest.v0.json`), 시범보드(`data/work100/pilot/`), 데모 v7(아티팩트 a595e7de — 사용자 확정 비주얼), korea100studio(MIT, board-v1).
> **상태**: v1 초안 (2026-07-21). 사용자 지시 4건(모달 재구성·보드 배색·화면 토글·공간 재조정)은 데모 v7에 선반영·확정.

## 1. 화면 구조 (사용자 지시 확정)

```
/knowledge (AI지식검색 페이지) — 두 개의 완전히 상이한 전체 화면, 상단 중앙 토글만 공통
├─ 상단 중앙 단독 배치 토글(메인 초기화면 스타일): [ 업무탐색 | 지식검색 ]  ← 기본값 = 업무탐색
├─ 업무탐색 화면 = 3D 무한성 (전용 레이아웃: 부서 칩·검색 하이라이트·범례·라벨 — 데모 v7 그대로)
│    · 공간: v7 확정 — 원경 진입(줌아웃 시 큐브 전체) + 내부 대공동(중앙 ell r≈(34,26,34),
│      부서 포켓들과 연결된 하나의 빈 공간) + 직각 통로 + 대기 시 통로 탐험
│    · 업무 노드 = 부서색 솔리드 큐브(창호 텍스처 없음, emissive 0.4 기본)
│    · 노드 클릭 → ①온톨로지 패널(단독 모달 560px: 소관·전결·근거 사규·버튼)
│                   ②[상세 업무흐름 보기] → 전체화면 스윔레인 보드(흐름재생·줌·접기)
│                   ③[접기] → 온톨로지 패널 복귀
└─ 지식검색 화면 = 기존 AI지식검색 UI 전체를 그대로(질문 입력·답변·근거 — 레이아웃 공유 없음)
```

- **화면 전환 연출**: 지식검색 → 업무탐색 전환 시 게임식 **로딩 스크린** — 다크 오버레이 + 진행 문구
  (예: "무한성 공간 구성 중 — 다다미 적층…" → "통로 개통…" → "업무 큐브 배치…") + 완료 시 원경 페이드인.
  실제 씬 생성 비용(복셀 인스턴싱·CanvasTexture 생성, 수백 ms~수 초)과 결합된 정직한 로딩으로 구현하고,
  씬은 최초 1회 생성 후 메모리 유지(재전환 시 즉시 표시, 로딩 생략). 업무탐색 → 지식검색은 즉시 전환.
- 토글 상태는 localStorage 기억(최초 방문 기본 = 업무탐색). 3D 미지원 환경(WebGL 실패)은 로딩 스크린에서 안내 후 지식검색 화면 폴백.
- 보드 배색 = **무한성 한지·목조 팔레트**(sample 프로필: 앰버·목조 브라운·청록 회귀 + 구조색 워밍 매핑) — 데모 v7 확정 룩.

## 2. 데이터 계층

### 2.1 저장 (MongoDB, 신규 3컬렉션 — 기존 격리 원칙 유지)

| 컬렉션 | 내용 | 키·규약 |
|---|---|---|
| `ontology_nodes` | work(Task)·org(Dept·Position) 노드 | manifest.v0 node_common_fields. id 불변 슬러그 |
| `ontology_edges` | 소관·전결·업무근거·선행·협업·부서상하 | manifest.v0 edge_common_fields + unique_keys. corpus 앵커=(title,name,srcHash), ci 금지 |
| `work100_boards` | board-v1 JSON(내부 절차 원장) + 렌더 캐시 | { _id, taskId, board(json), svg, motionSvg, audit:{score,metrics}, status, updatedAt } |

- `rag_graph_edges`는 불가침(기존 kind 소유물). 런타임 소비는 **promoted & !stale**만(불변식).
- 렌더 캐시: 승인 시점에 SVG·모션 SVG를 서버에서 1회 생성해 문서에 저장(조회 시 렌더 비용 0). 모션은 **freeze 패치**(1회 재생) 적용.

### 2.2 생성 파이프라인 (Phase 1)

**Task 정체성 = 큐레이션 단위(2026-07-22 확정).** Task는 분장업무 항목 1:1이 아니라, 분장업무·전결사항·조문을
의미 단위로 묶은 것(시범보드 '수의계약 체결' 방식, 목표 ~100개). 별표는 소스로 참조하며 Task 도출은 M2.

```
[M1 시드 — 결정적, LLM 무관] (완료: 커밋 c0b5861)
 직제 규정 제6조 → Dept 트리(deptPath·kind·order) 21건 + 부서상하 엣지 15건 (rule/validated)
 · 지역본부(별표 제7호)는 세로쓰기 정제 필요 → M2 착수 시 별도(현재 본사 조직만)
[M2 Task 도출 — 큐레이션 단위, LLM+검수]
 소스: 직제세칙 별표 제6·7호(부서별 분장업무), 위임전결 별표 제1호(전결사항 285행, gloss는 후보 전용), 사규 조문
 · LLM이 부서별로 의미 단위 Task 후보 도출(분장업무 여러 항목을 묶거나 분할)
 · Task별 엣지 candidate: 소관(→Dept) · 전결(→Position, limit{min,max,text}·positionRule 원문 절취)
   · 업무근거(→조문, 회수 retrieveRagRegulationsForQa 재사용 → 조문 선별+basis 분류)
 보드 초안: SKILL.md 4요소 추출 규칙 프롬프트 → board-v1 JSON(edge.type 필수 강제, 스테이지≤9)
[기계 게이트 — validated]
 ①매니페스트 정합 ②앵커 실존(스텁 방지: 동일 번호 최장본문·50자 미만 거부) ③evidence 원문 대조
 ④양단 노드 상태 ⑤보드: ajv 스키마+checkReferentialIntegrity+audit(nodePiercings=0 하드)
 실패 사유는 재생성 프롬프트에 피드백(validate-render 루프, 최대 2회)
[관리자 승인 — promoted]
 /admin 온톨로지 탭: 검토 큐(rtConf·audit 점수·evidence 원문 나란히) → 승인/수정/기각
 승인 시 보드 SVG 렌더 캐시 생성. 임시 우회로: src/scripts/ontology-promote.ts (method:human)
```

### 2.3 배포·폐쇄망
- korea100studio를 `vendor/korea100studio/`로 벤더링(MIT 고지 유지, ajv 1개·순수 Node — 반입 부담 無). sample 프로필 포함(`scripts/lib/profiles.mjs`).
- 스냅샷 재export에 신규 3컬렉션 + 법령 적재분 + law 엣지 갱신 포함(`export/update-rag-db` 갱신 — 컬렉션 명시 나열 함정 주의).

## 3. API

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/work100/map` | 3D 지도 데이터 — langent식 3계층 `{graph:{depts,tasks,edges}, crossLinks:업무근거, stats}` (promoted만) |
| `GET /api/work100/task/[id]` | 온톨로지 패널 데이터 — Task+소관·전결·업무근거(evidence 포함)+boardId |
| `GET /api/work100/board/[taskId]` | 렌더 캐시 SVG(정적/모션) — `Content-Type: image/svg+xml` |
| `POST /api/admin/work100/*` | 생성 트리거·검토 큐·승격(ADMIN_ACCESS_KEY, 감사로그) |

- "근거 조문 보기" = 기존 조문 직행(regulations-lookup) 재사용 — 외부규범도 적재돼 있어 원문 표출 가능(카테고리 배지 표시). "지식검색에 질문" = 검색 뷰 전환+프리필.
- 3D 씬 자산: three.js는 이미 리포 의존성(three.js-dashboard 계열 아님 — 신규 추가 시 폐쇄망 npm 캐시 동봉). 데모의 `three-global.js` 방식 대신 정식 import.

## 4. 구현 시 확정 함정 (실증됨)

1. **SVG 다중 인라인 id 충돌**: 정적+모션 보드를 같은 문서에 넣으면 filter/marker id 충돌로 카드가 소실됨(v6.1 실증) → 모션 SVG id `_m` 네임스페이스 필수. 렌더 캐시 생성 시 서버에서 처리.
2. **SMIL 재생**: `repeatCount=1 + fill=freeze` + 재생 클릭 시 `setCurrentTime(0)`.
3. **edge.type 누락 = layout TypeError**, lane/stage 문자열 정확 일치, 스테이지 6~9 상한 — LLM 생성 스키마에서 강제.
4. **회수 격리**: work100 컬렉션은 지식검색 회수에 유입 금지(별도 컬렉션이라 자동 격리). 벤치 회귀 0 확인을 릴리스 게이트로.
5. tsx 스크립트 dotenv 임포트 순서(env 직접 주입 필요) — 파이프라인 CLI 공통.

## 5. 마일스톤

| 단계 | 산출물 | 게이트 | 상태 |
|---|---|---|---|
| M1 인프라·조직축 | 검증기(매니페스트 하드 강제)·컬렉션·조직축 시드(Dept·부서상하) | test:ontology 통과, 대사 리포트, 벤치 회귀 0 | **완료(c0b5861)** |
| M2 Task 생성 | Task 큐레이션 도출 + 소관·전결·업무근거 + 보드 생성 + validate-render + 승인 큐(/admin 탭) | 시범 10업무 promoted, 수락 3형 질의 골드셋 통과 | 착수 대기 |
| M3 화면 | /knowledge 토글 + 3D 지도(실데이터) + 패널/보드 모달 | 데모 v7 동등 UX, WebGL 폴백 | — |
| M4 확장 | 전 부서 업무(별표 제6·7호 전량)+지역본부, 통로 탐험·검색 하이라이트 고도화 | 관리자 승인율·사용 텔레메트리 | — |

## 변경 이력
- v1.2 (2026-07-22) M1 완료 반영 — **Task 정체성=큐레이션 단위 확정**. 소관·전결·업무근거는 M1(시드)→M2(LLM 도출)로 재배치(Task 의존). M1은 조직축(Dept·부서상하)+인프라로 완결.
- v1.1 (2026-07-21) 화면 토글 확정(상단 중앙 [업무탐색|지식검색], 게임식 로딩).
- v1 (2026-07-21) 초안 — 사용자 지시 4건 데모 v7 선반영·확정 후 작성.
