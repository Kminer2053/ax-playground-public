# 다중 사용자 동시성 하드닝 — 구현·운영 기록

> 상태: **Phase 0~2 구현 완료**(2026-06-19) · 배포 토폴로지: **단일 인스턴스(수직 확장)**
> 이 문서는 *무엇을 어떻게 고쳤고 어떻게 운영하는가*를 다룬다. 점검 근거·대안·의사결정은 [CONCURRENCY_REVIEW.md](CONCURRENCY_REVIEW.md) 참조.

## 1. 배경

운영 전환을 앞두고 사내 임직원 **동시 수십~수백 명** 이용을 대비해 전체 코드를 점검하고 하드닝했다. 이 앱의 진짜 병목은 Node가 아니라 **단일 내부 LLM 서버**이므로, 프로세스를 늘리는 대신 **단일 인스턴스 + 동시성 게이트**로 대응한다(근거: 점검 문서의 "배포 토폴로지" 절).

핵심 방침 두 가지:
- **(A) DB 인덱스를 운영에서 실제로 생성** — atomic 보장(rate-limit·usage)이 성립하는 토대.
- **(B) 단일 LLM 서버·서브프로세스에 동시 호출 상한** — 과부하 시 무너지지 않고 우아하게 거절(백프레셔).

## 2. 구현 요약

| 영역 | 변경 내용 | 핵심 파일 | 커밋 |
|------|-----------|-----------|------|
| **DB 토대** | `autoIndex:true`(부팅 시 인덱스 1회 빌드)·커넥션 풀 10→**50** | `src/lib/db.ts` | `11c4dbe` |
| **LLM 동시성** | 전역 **세마포어(동시 8 / 대기 24)** + 타임아웃 **180s** + 재시도 **1** + 큐 만원 시 즉시 거절 → **503**; 클라이언트 abort 전파(`ctx.signal`→OpenAI 호출) | `src/lib/semaphore.ts`(신규) · `src/lib/llm.ts` · `src/lib/guardrails/*` | `11c4dbe` · `3f20dce` |
| **서브프로세스 상한** | 무거운 자식 프로세스(HWPX 빌더·OCR·kordoc)를 **하나의 세마포어(동시 4 / 대기 12)**로 총량 공유 | `src/lib/subprocess.ts`(신규) · `ocr.ts` · `docparse.ts` · `api/docs/generate` | `cc9e769` |
| **감사 비동기화** | 응답 경로에서 `await recordAudit` 제거 → `void`(`.catch`만), fail-open 유지 + 파일 로그 **단일 writer 직렬화**(JSONL 인터리브 방지) | `src/lib/guardrails/index.ts` · `output/audit.ts` | `cc9e769` · `3f20dce` |
| **신원 / rate-limit** | 무로그인 IP-only → **익명 쿠키 `ax_anon`** 발급(미들웨어)로 per-user 버킷(NAT 뒤 단일 버킷 오탐 방지) | `src/middleware.ts` · `guardrails/context.ts` · `input/ratelimit.ts` | `cc9e769` |
| **라이브러리 투표** | `findById`→JS수정→`save()`(lost-update) → **atomic**(`$inc`/`$addToSet`/`$pull`) | `api/library/[id]/vote/route.ts` | `3f20dce` |
| **업로드 가드** | 저장 전 **디스크 여유 점검**(`statfs`) + 첨부 **최대 10개** 상한 | `src/lib/upload.ts` · `api/library/route.ts` | `3f20dce` |
| **관리자 통계** | AuditLog 전량 메모리 로드 → MongoDB **`$facet` 집계**(요약만 반환) | `api/admin/guardrails/stats/route.ts` | `b0ec348` |

## 3. 새 구성요소

- **`src/lib/semaphore.ts`** — `Semaphore(maxConcurrent, maxQueue)`. 슬롯 초과 시 짧은 대기열, 대기열까지 차면 `CapacityError`를 던진다(호출 측에서 503으로 매핑). 단일 프로세스 전제의 프로세스-로컬 게이트.
- **`src/lib/subprocess.ts`** — `execFileLimited`. `promisify(execFile)`과 동일 인터페이스이되 위 세마포어로 동시 실행을 묶는다. 모든 서브프로세스 호출처가 하나의 한도를 공유한다.
- **미들웨어 `ensureAnonId`** — 쿠키 `ax_anon`(무작위 ID)을 최초 1회 발급. 무로그인 환경의 per-user rate-limit 신원으로 사용.

## 4. 런타임 동작(과부하 시)

- **정상** — LLM 동시 8건까지 즉시 실행.
- **대기** — 8건 초과분은 최대 24건까지 큐에서 대기(슬롯이 비면 인계).
- **거절(백프레셔)** — 동시 8 + 대기 24를 모두 초과하면 `CapacityError` → **HTTP 503**(잠시 후 재시도 안내). 호스트가 죽는 대신 빠르게 되돌려준다.
- **rate-limit** — 사용자×패널 **30회/분** 초과 시 **HTTP 429**. 신원은 `ax_anon` 쿠키 기준(프록시 real-IP 전달 시 IP 보조).
- **서브프로세스(문서/OCR)** — 동일 원리로 동시 4 + 대기 12, 초과 시 거절.

## 5. 운영 노브(환경변수)

모델 서버의 배치 처리 용량에 맞춰 조정한다. 모두 `.env.local`에서 변경 가능(기본값 내장).

| 변수 | 기본값 | 의미 |
|------|--------|------|
| `LLM_MAX_CONCURRENCY` | `8` | LLM 동시 호출 상한(모델 서버 배치 용량에 맞춤) |
| `LLM_MAX_QUEUE` | `24` | LLM 대기열 길이(초과 시 503) |
| `LLM_TIMEOUT_MS` | `180000` | LLM 호출 타임아웃(ms) |
| `LLM_MAX_RETRIES` | `1` | LLM 재시도 횟수 |
| `SUBPROC_MAX_CONCURRENCY` | `4` | 서브프로세스(문서빌드·OCR·kordoc) 동시 상한 |
| `SUBPROC_MAX_QUEUE` | `12` | 서브프로세스 대기열 길이 |

> 권장 튜닝 순서: 실제 모델 서버에서 **부하테스트로 LLM 동시 처리량을 측정** → `LLM_MAX_CONCURRENCY`를 그 값에 맞춤(과소설정은 처리량 손해, 과대설정은 지연 폭주).

## 6. 수용능력(개략)

- **LLM 계열 기능**(지식검색·민원답변·안전·매장진단·광고심의·문서생성) — 동시 8 + 버스트 대기 24 ≈ 순간 32건까지 수용, 초과는 즉시 503. 실제 응답 시간은 모델 서버 성능에 종속.
- **비-LLM 요청**(목록·조회·투표·통계) — 커넥션 풀 50 + atomic 연산으로 높은 동시성 수용.
- **검증** — 설계 용량 기준 부하테스트에서 과부하 시 **503/429로 우아하게 degrade**하고 붕괴(행/메모리 폭주)하지 않음을 확인. 단, 실모델 서버 기준 **실측 튜닝은 권장 다음 단계**(아래 8절).

## 7. 배포 요건(필수 체크)

1. **단일 인스턴스로 기동**(`next start` 1개). 세마포어·설정캐시·감사파일 writer가 프로세스-로컬 전제다. 멀티인스턴스 전환 시 8절 추가 항목 필요.
2. **리버스 프록시 real-IP 포워딩** — `ax_anon` 쿠키가 1차 신원이지만, 프록시가 `X-Forwarded-For`/`X-Real-IP`를 넘기지 않으면 IP 보조 신원이 전원 `unknown` 단일 버킷이 된다.
3. **인덱스 생성 확인** — `autoIndex:true`로 부팅 시 자동 빌드되나, go-live 전 핵심 인덱스(특히 `GuardRateLimit.key` unique, `FeatureUsage` unique, `AuditLog.createdAt`) 존재를 반드시 검증.
4. **디스크 여유** — 업로드·DB·감사로그가 볼륨을 공유하면 디스크 풀이 동반 장애가 된다. 여유 공간 모니터링(업로드는 `statfs` 가드 내장).

## 8. 남은 과제

- **실측 튜닝** — 실제 모델 서버에서 `LLM_MAX_CONCURRENCY` 등 부하테스트 기반 조정(권장 우선).
- **멀티인스턴스 전환 시(현재 비활성)** — 설정캐시 무효화·감사 파일 동시 append·DB 풀 N배 항목을 추가 처리해야 함(점검 문서 Medium 참조).
- **업로드 부분실패 orphan 정리**(영향 작음).

## 관련 문서
- [CONCURRENCY_REVIEW.md](CONCURRENCY_REVIEW.md) — 점검 상세(도메인별 발견사항·근거·대안·토폴로지 의사결정)
- [ARCHITECTURE.md](ARCHITECTURE.md) — 패널별 동작 구조
