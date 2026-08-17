# 운영 전환 — 다수 사용자 동시성·확장성 점검 및 하드닝 계획

> 작성: 2026-06-19 · 상태: **검토 완료 / 수정 미착수(계획)** · 대상 부하: 사내 임직원 동시 수십~수백 명
> 방법: 도메인 4개(인메모리 상태/캐시 · DB 쓰기·쿼리 · LLM·스트림·서브프로세스 · 업로드·신원·감사·rate-limit)로 나눠 **읽기 전용** 코드 점검.

## 종합 판단

아키텍처는 근본적으로 **견고하다**: 요청 간 데이터 누수 0건(54개 라우트 전수), 대부분의 카운터가 atomic, 감사 fail-open, temp 디렉터리 정리 견고, iron-session 무상태. 문제는 **소수의 집중된 지점**이며, 두 축으로 요약된다.

- **(A) MongoDB 인덱스가 운영에서 실제로 안 만들어짐** — `autoIndex:false` + `syncIndexes` 부재 + 시드 스냅샷에 인덱스/일부 컬렉션 누락. "atomic이라 안전"하다던 여러 보장(rate-limit·usage)이 이 위에서만 성립하므로 **토대 결함**.
- **(B) 단일 내부 LLM 서버에 대한 동시 호출·서브프로세스 스폰에 상한이 없음** — 다수 사용자 시 과부하의 핵심 런타임 병목.

가장 임팩트 큰 둘은 **C1(인덱스)·C2(LLM 세마포어+타임아웃)**. 이 둘만으로 "다수 사용자 시 무너지는" 시나리오 대부분이 막힌다.

---

## ✅ 구현 현황 (2026-06-19 · 배포 토폴로지: 단일 인스턴스 채택)

- **Phase 0** — C1 DB 인덱스 자동생성(autoIndex)·풀 10→50 / C2 LLM 동시호출 세마포어 + 타임아웃 180s·재시도 1 + 503 백프레셔 → `11c4dbe`
- **Phase 1** — C3 서브프로세스 세마포어 / H1 감사 비동기화(void) / H2 rate-limit 익명쿠키(ax_anon) 신원 / H3 abort 전파(ctx.signal) → `cc9e769`·`3f20dce`
- **Phase 2** — H4 통계 `$facet` 집계 / 감사파일 단일 writer 직렬화 / 투표 atomic(`$inc`/`$addToSet`류) / 업로드 디스크여유 점검 + 첨부 10개 상한 → `3f20dce`·`b0ec348`
- **제외(오탐)** — 스트리밍 PII 재스캔 "O(n²)": 버퍼를 매 청크 flush해 이미 O(n)이라 비해당.
- **보류/선택** — 멀티인스턴스 전용 항목(설정캐시 무효화·N×풀: 단일 인스턴스 채택으로 비활성) · 업로드 부분실패 orphan 정리(소) · **부하테스트로 `LLM_MAX_CONCURRENCY` 등 실측 튜닝(권장 다음 단계)**.

운영 노브(env, 기본값): `LLM_MAX_CONCURRENCY`=8 · `LLM_MAX_QUEUE`=24 · `LLM_TIMEOUT_MS`=180000 · `LLM_MAX_RETRIES`=1 · `SUBPROC_MAX_CONCURRENCY`=4 · `SUBPROC_MAX_QUEUE`=12. 모델 서버 용량에 맞춰 조정.

---

## 🔴 Critical — 운영 전 필수

### C1. MongoDB 인덱스가 운영에 생성되지 않음
- 위치: `src/lib/db.ts:20`(`autoIndex:false`), 리포 전체에 `syncIndexes()`/`ensureIndexes()` 호출 0건, `data/mongo-snapshot/dump-2026-06-18/axplayground/*.metadata.json` (libraryposts는 `_id_`만, auditlogs·featureusages·quizrankings·guardratelimits·quizlogs는 스냅샷에 부재 → 첫 쓰기 때 인덱스 없이 자동생성).
- 영향: `GuardRateLimit.key` unique 부재 → **버스트 시 rate-limit 무력화**(중복 버킷) + `expiresAt` TTL 부재 → 컬렉션 무한 증식; `FeatureUsage{feature,action,day}` unique 부재 → 사용량 중복 카운트; libraryposts·auditlogs 조회 COLLSCAN.
- 권장: 폐쇄망 단일서버면 `autoIndex:true` 허용(부팅 시 1회 빌드, 이 규모엔 무해) **또는** 시작 시 전 모델 `syncIndexes()` 부트스트랩 **또는** 인덱스 빌드 후 스냅샷 재생성. **go-live 전 인덱스 존재를 반드시 검증.**

### C2. LLM 동시 호출에 상한·큐 없음 (+ SDK 기본 타임아웃 10분·재시도 2회)
- 위치: `src/lib/llm.ts:114`(chatLlm)·`:135`(streamChatLlm)·`:28`(OpenAI 클라이언트 — timeout/maxRetries 미지정 → 기본 600s·2회). 가드레일 레이어에도 게이트 없음.
- 영향: 100명 동시 → 단일 모델서버에 100 동시 디코드 → VRAM/KV 캐시 고갈·지연 폭주. `/api/ad/review`는 요청당 최대 5회, `/api/docs/generate` 커스텀폼은 4회+ LLM 호출. 느려지면 10분 hang이 쌓이고 2회 재시도가 과부하를 증폭.
- rate-limit로는 못 막음: `GuardRateLimit`는 **사용자×패널 30/분**이라 시스템 전체 동시성을 제한하지 못함.
- 권장: `chatLlm`/`streamChatLlm`(또는 가드레일 래퍼)에 **전역 세마포어**(동시 N, 모델서버 배치 용량에 맞춰 4~16) + 초과 시 짧은 큐, 큐 만원이면 **빠른 503/429 + retry-after**. **타임아웃을 수십 초로, `maxRetries`를 0~1로**(`llm.ts:28`).

### C3. 파이썬/kordoc 서브프로세스 스폰에 상한 없음 (프로세스 폭주)
- 위치: `src/app/api/docs/generate/route.ts`(finalizeDoc: 1p/gongmun 파이썬 3개, full 4개 + kordoc fill/patch/strip_lineseg), `src/lib/ocr.ts:65`(이미지당 파이썬), `src/lib/docparse.ts:53`(첨부당 kordoc).
- 영향: 20명 동시 문서생성 → 60~100+ 중량 프로세스 동시 → CPU/RAM 고갈·이벤트루프 정지. `build_full`은 최대 120s 코어 점유. RapidOCR는 모델 로드가 무거움. LLM과 별개의 호스트 다운 경로.
- 권장: **서브프로세스 전용 전역 세마포어**(문서빌드 파이프라인 2~4, OCR 소수 동시). OCR은 기존 `http` 사이드카(`ocr.ts:80`)로 전환해 모델 로드 비용 상시화 검토.

---

## 🟠 High

### H1. 감사로그가 응답 경로에서 `await`됨 (DB insert + 파일 append)
- 위치: `src/lib/guardrails/index.ts:142·165·181·196`(+스트림 ~224·278·293) 전부 `await recordAudit(...)`; `recordAudit`는 `appendFile` + `AuditLogModel.create`를 await(`output/audit.ts`).
- 영향: 모든 LLM 응답에 파일·DB I/O 지연이 더해지고, 매 호출이 `maxPoolSize:10` 풀을 잠식(주석은 "fire-and-forget"이나 실제로 await).
- 권장: 성공 경로에서 **await 제거(.catch만)** 또는 백그라운드 배치. fail-open은 유지.

### H2. rate-limit 신원이 IP-only (무로그인 → userId 항상 null)
- 위치: `src/lib/guardrails/context.ts:24`(userId:null 고정)·`:9`(XFF/Real-IP, 없으면 `"unknown"`), `src/lib/guardrails/input/ratelimit.ts:15`.
- 영향: 사내 NAT/프록시 뒤 수백 명이 **한 버킷 공유 → 정상 사용자 오탐 차단**. 프록시가 real-IP를 안 넘기면 전원 `ip:"unknown"` 단일 버킷.
- 권장: 버킷 키를 voterId/익명 쿠키 기반 per-user로. 리버스 프록시 real-IP 포워딩을 **배포 필수 요건**으로 문서화·기동 시 경고.

### H3. 클라이언트 abort가 서버로 전파되지 않음
- 위치: 어떤 API 라우트도 `req.signal` 미사용; SSE `ReadableStream`에 `cancel()` 없음(`knowledge/assistant`·`ad/review`·`docs/generate`). 클라엔 AbortController 존재(`PanelDocs.tsx:296·404`).
- 영향: 탭 닫기/취소 시에도 LLM 스트림·서브프로세스가 끝까지 진행 → 과부하 시 낭비 가중, 재시도로 상류 작업 증식.
- 권장: `req.signal`을 가드레일→`chatLlm`/`streamChatLlm`→OpenAI 호출 옵션·`pExecFile`까지 전파, SSE에 `cancel()` 추가.

### H4. 관리자 통계가 무제한 집계 (AuditLog 전량 메모리 로드)
- 위치: `src/app/api/admin/guardrails/stats/route.ts:49` — `.find(범위).lean()`에 `.limit()` 없음, JS로 집계.
- 영향: AuditLog는 LLM 호출당 1행으로 최고속 증가 → 기간 넓은 단발 요청이 단일 서버를 정지(메모리 스파이크·이벤트루프 정지, C1로 COLLSCAN 가중).
- 권장: Mongo `$match`+`$group` 파이프라인으로 요약만 반환 + 최대 look-back 상한. `{createdAt:-1, outcome:1}` 인덱스 보장(C1).

---

## 🟡 Medium

| 항목 | 위치 | 요지 |
|------|------|------|
| 감사 파일 append 인터리브 | `output/audit.ts:34` | 동시 append + `AUDIT_LOG_FULL_TEXT=true`(긴 줄) → JSONL 깨질 수 있음. 단일 writer 직렬화 또는 파일로그 best-effort 강등 |
| `maxPoolSize:10` | `db.ts:18` | 다수 동시 + 감사/usage/rate-limit 같은 풀 경쟁 → 큐잉 지연. 50~100 상향 |
| 라이브러리 투표 lost-update | `library/[id]/vote/route.ts:24` | `findById`→JS수정→`save()`(전체 덮어씀, voters 무한증가). `$inc`/`$addToSet`/`$pull`로 |
| 업로드 디스크 쿼터 없음 | `upload.ts`, `library/route.ts:93` | 개수·총량 미제한, 공유 볼륨(업로드+DB+감사) → 디스크 풀 시 동반 장애. 개수/여유공간 가드 + 전용 볼륨 |
| 스트리밍 PII 재스캔 O(n²) | `guardrails/index.ts:250` | 청크마다 전체 버퍼 재스캔. 꼬리 구간으로 한정 |
| 설정캐시 무효화 per-process | `playgroundConfig.ts`·`guardrails/config.ts`·`ad-rules.ts` | 멀티인스턴스에서만 ≤30s 불일치. 단일 인스턴스면 비이슈 |

업로드 부가(낮음): 실패 후 부분파일 orphan(`library/route.ts:81`), 비원자적 writeFile(`upload.ts:48`), `UPLOAD_DIR` 분기 항상 throw 잠재버그(`upload.ts:50`).

---

## ✅ 이미 안전 (재확인 — 재조사 불필요)

- **요청 간 데이터 누수 0건**(54개 라우트). 모듈 스코프 가변 상태는 공개/누수안전 캐시뿐.
- 정규식 `/g` lastIndex 안전(전부 동기 실행). mongoose 연결 싱글톤(promise 메모이즈·실패 리셋, `db.ts`).
- rate-limit 카운터 증가 atomic(`findOneAndUpdate $inc upsert`, 윈도우를 키에 포함) — **단 C1 unique 인덱스 전제**.
- usage atomic upsert(`usage.ts:21`) · 조회/다운로드수 `$inc`(`library/[id]/route.ts:19`) · 댓글 `$push`/`$pull` — **C1 전제 항목 포함**.
- temp 디렉터리 `finally rm` 견고(전 오류 경로), 서브프로세스 타임아웃·maxBuffer·maxTokens 전부 설정, 감사 fail-open.
- 업로드 파일명 `randomUUID().ext`(충돌 없음)·확장자 화이트리스트·경로탈출 차단.
- iron-session 무상태(멀티인스턴스 OK, `SESSION_SECRET` 공유 전제) · 관리자 키 timingSafeEqual.

> **현재 미연결 코드**(지금 노출 없음, 활성화 시 atomic 필요): 포인트(`points.ts awardPoints` 미호출), 프롬프트 좋아요(엔드포인트 없음), VOC 상태 쓰기(라우트 없음).

---

## 선결 의사결정 — 배포 토폴로지

| | 단일 인스턴스(`next start`) | 클러스터/다중(PM2 cluster·다중 컨테이너) |
|---|---|---|
| 프로세스 | 1개 | N개(코어당/컨테이너당) |
| 인메모리 캐시 | 한 곳 공유 → 단순 | 프로세스별 N벌 → 설정캐시 ≤30s 불일치 |
| DB 풀 | 10 | N×10 |
| 감사 파일 | 한 writer | N개 동시 append(깨짐 위험↑) |
| CPU | JS 1코어(I/O는 비동기로 다수 동시 OK) | 전 코어 |

이 앱의 병목은 **단일 LLM 서버**라 Node를 늘려도 LLM이 한계. → **단일 인스턴스(수직 확장) + C2 LLM 세마포어 권장.** 단일로 가면 위 Medium의 "설정캐시·감사파일·풀×N"이 **잠재화**되어 범위가 줄어든다. 클러스터로 가면 그 3개를 추가 처리해야 한다.

---

## 단계별 하드닝 계획

**Phase 0 — 토대(작고 필수, 운영 직전)**
- C1 인덱스 생성·검증 / C2 LLM 세마포어 + 타임아웃·재시도 축소.

**Phase 1 — 부하 차단**
- C3 서브프로세스 세마포어(+OCR http 사이드카 검토) / H1 감사 비동기화 + 풀 상향 / H2 rate-limit per-user 신원 + 프록시 real-IP / H3 abort 전파·SSE cancel.

**Phase 2 — 하드닝**
- H4 통계 집계 파이프라인 / 감사 파일 직렬화 / 투표 atomic / 업로드 쿼터·전용 볼륨 / 스트리밍 PII 재스캔 한정.

**선결**: 배포 토폴로지(단일 권장) 결정 → 멀티인스턴스 시 설정캐시·감사파일·풀 항목 추가.

---

## 참고 — 핵심 파일
`src/lib/db.ts`(C1·풀) · `src/lib/llm.ts`(C2) · `src/app/api/docs/generate/route.ts`·`src/lib/ocr.ts`(C3) · `src/lib/guardrails/index.ts`(H1·H3·PII) · `src/lib/guardrails/output/audit.ts`(H1·감사파일) · `src/lib/guardrails/context.ts`·`input/ratelimit.ts`(H2) · `src/app/api/admin/guardrails/stats/route.ts`(H4) · `src/app/api/library/[id]/vote/route.ts`·`src/lib/upload.ts`(Medium).
