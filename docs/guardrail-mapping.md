# AX Playground LLM 가드레일 — 통제 매핑서 (감리 대응)

**근거**: 국가·공공기관 AI보안 가이드북 v2.0 (M09·M13·M14·M15·M16·M27)
**대응 설계도**: `ax_portal_guardrail_architecture.svg` (입력·모델·출력 3단계 다중 가드레일)
**구현 방식**: Next.js 내장 TypeScript (단일 코드베이스). 다이어그램은 Python 생태계(FastAPI/llm-guard/presidio/slowapi)를 예시 도구로 표기하나, 본 시스템은 동등 기능을 TypeScript로 구현. 아래 표에 도구 ↔ 구현 1:1 매핑.

---

## 1. 통제 매핑 표

| 단계 | 통제 | 가이드북 ID | 다이어그램 예시 도구 | 실제 구현 (파일 · 함수) |
|---|---|---|---|---|
| **GR1 입력** | 입력 길이 제한 (8,000자/토큰) | M14 | FastAPI limit | `input/length.ts` · `checkLength()` |
| | 프롬프트 인젝션·탈옥 탐지 | M14 | llm-guard PromptInjection | `input/injection.ts` · `checkInjection()` (점수제 룰셋) |
| | PII 입력 차단 | M13 | presidio Analyzer | `input/pii.ts` · `checkInputPii()` + `pii-patterns.ts` · `detectPii()` |
| | 요청 속도 제한 (30/분) | M14·M27 | slowapi | `input/ratelimit.ts` · `checkRateLimit()` + `models/GuardRateLimit.ts` (Mongo TTL) |
| **GR2 모델** | 시스템 프롬프트 (금지·역할·탈옥거부) | M15 | Ollama Modelfile SYSTEM | `model/system-prompt.ts` · `SECURITY_PREAMBLE` / `buildSystemPrompt()` + `infra/ollama/Modelfile.ax` |
| | 모델 파라미터 제한 (num_predict/ctx) | M14 | Ollama Modelfile PARAMETER | `infra/ollama/Modelfile.ax` (PARAMETER) |
| | 모델 정보 유출 방지 | M16 | Nginx 응답 헤더 제거 | `infra/nginx/security.conf` (server_tokens off, proxy_hide_header) |
| **GR3 출력** | PII 마스킹 (`[RRN]`/`[PHONE]` 등) | M13 | presidio Anonymizer | `output/pii-mask.ts` · `maskOutputPii()` |
| | 민감정보 필터 (자격증명·IP·악성코드) | M13 | llm-guard Output | `output/secrets.ts` · `scanOutputSecrets()` |
| | 감사 로그 (입·출력 전문) | M09 | /var/log/axp-audit.log | `output/audit.ts` · `recordAudit()` + `models/AuditLog.ts` (파일+DB 이중) |
| **모니터링** | 일일 리포트·이상탐지 (cron 09:00) | M09 | log_analyzer.py | `scripts/log-analyzer.ts` (`npm run report:audit`) |

**통합 게이트웨이**: `src/lib/guardrails/index.ts` · `guardedChat()` / `guardedStreamChat()`
→ 입력가드 → LLM → 출력가드 → 감사로그를 단일 경로로 처리. 모든 LLM 호출 라우트가 이 게이트웨이를 경유.

---

## 2. 적용 라우트 (전수)

LLM을 호출하는 모든 API가 게이트웨이를 경유한다. 직접 `chatClaude`/`askClaude` 호출은 제거됨(`ai/status`의 헬스체크 ping만 예외).

| 라우트 | 패널 | 호출 형태 |
|---|---|---|
| `api/ai/chat` | ai | guardedChat |
| `api/law/assistant` | law | guardedStreamChat + guardedChat (RAG) |
| `api/law/search` | law | guardedChat ×2 |
| `api/law/review` | law | guardedChat |
| `api/pr/draft` | pr | guardedChat |
| `api/sales/diagnosis` | sales | guardedChat |
| `api/safety/chat` | safety | guardedChat (텍스트 + **멀티모달 이미지 분석** 모두 경유) |
| `api/voc/items/[id]/suggest` | voc | guardedChat |

---

## 3. 정책 결정 사항 (감리 설명용)

1. **PII 입력 차단 범위**: 고위험 식별번호(주민/외국인등록/신용카드/계좌)는 **입력 차단**, 연락처(전화·이메일·사업자번호)는 **입력 허용 + 출력 마스킹**. 다이어그램은 "주민번호·전화번호" 차단을 예시하나, 전화번호 입력 전면 차단은 정상 업무(법무 자문·VOC 등)를 방해하므로 출력 마스킹으로 대체. 차단 대상은 `input/pii.ts`의 `BLOCK_ON_INPUT` 집합에서 운영 정책에 따라 조정 가능.

2. **RAG 컨텍스트 처리**: 법무 어시스턴트는 사규 본문(수천 자)을 LLM에 전달한다. 입력 가드는 사용자의 실제 질문(`guardInput`)만 검사하고, 신뢰 가능한 사규 컨텍스트는 길이/PII 검사에서 제외한다. (사규 본문 오탐·길이초과 방지)

3. **다중 방어(Defense in Depth)**: 시스템 프롬프트 보안 규칙을 **애플리케이션 레이어**(`SECURITY_PREAMBLE`)와 **모델 레이어**(`Modelfile SYSTEM`) 양쪽에 동일하게 적용. 두 텍스트는 반드시 동기화한다(한쪽만 수정 금지).

4. **감사 로그 fail-open**: 로그 기록 실패가 사용자 요청을 막지 않는다(가용성 우선). 파일 기록 실패 시 DB만, DB 실패 시 파일만 기록하며 경고를 남긴다. `AUDIT_LOG_FULL_TEXT=true`(기본)일 때 입·출력 전문을 기록(감리 요건). 로그 파일은 루프백/제한 권한(640)으로 보호.

5. **외부 인터넷 차단**: 채팅 LLM은 내부망 로컬(OpenAI 호환 API, Ollama)만 사용. Anthropic 등 외부 SDK는 제거됨. `output/secrets.ts`가 내부 IP(10./172.16-31./192.168./운영서버 고정 IP)를 출력에서 마스킹.

6. **Qdrant(벡터DB)**: 현재 임베딩은 MongoDB에 저장. 향후 RAG 강화를 위한 Qdrant 도입은 설계도에 to-be로 표기됨(현 코드 미사용).

7. **LLM 호출 경로 단일화(누수 차단)**: 모든 채팅·멀티모달 LLM 호출은 예외 없이 `guardedChat()`을 경유한다. 라우트가 OpenAI 클라이언트를 직접 생성하는 경로는 제거됨(과거 safety 이미지 분석이 우회했으나 게이트웨이로 통합). 의도적 예외는 두 가지뿐이며 사용자 데이터를 처리하지 않는다:
   - `api/ai/status`(헬스체크): 고정 입력 "Say OK"로 LLM 연결만 확인 — 감사 로그/rate limit 노이즈 방지 목적의 의도적 제외.
   - `lib/embedding.ts`(임베딩): 텍스트 생성이 아닌 벡터화. 출력이 벡터라 PII/시크릿 유출 경로가 아님 — 채팅 가드레일 범위 밖(후속 과제).

8. **LLM 실패도 모니터링에 기록(`error`)**: 입력 가드를 통과한 뒤 LLM 호출이 실패하면 `outcome="error"`(stage=model, ruleId=`model-error`)로 감사 기록 후 에러를 전파한다. LLM 장애가 대시보드 "오류(LLM)"에 집계되어 가시화된다(과거엔 누락되어 "총 요청"에도 안 잡혔음).

---

## 4. 차단 룰 ID 체계

차단 시 `ruleId`가 감사 로그·응답에 기록되어 가이드북 통제로 역추적된다.

| ruleId 접두 | 의미 |
|---|---|
| `M14-input-length` / `M14-input-tokens` | 입력 길이/토큰 초과 |
| `M14-injection:<hits>` | 인젝션 탐지 (매칭 룰 목록 포함) |
| `M13-input-pii` | 고위험 PII 입력 |
| `M14-M27-ratelimit` | 속도 제한 초과 |
| `M13-output-malicious:<id>` | 출력 악성코드 패턴 |
| `model-error` (outcome=error) | 입력 통과 후 LLM 호출 실패 (장애 가시화) |

---

## 5. 검증 방법

```bash
# 단위 테스트 (48 케이스: PII·인젝션·시크릿·시스템프롬프트)
npm run test:guardrails

# 타입 검사
npx tsc --noEmit

# 일일 리포트 수동 생성 (전일)
npm run report:audit
```

## 6. 관리 대시보드 · 제어판 (M09 운영)

관리자(role=admin)용 가드레일 운영 페이지.

- **페이지**: `/admin/guardrails` (`src/app/admin/guardrails/`) — 사이드바 "LLM 가드레일 관리"
- **모니터링 탭**: 기간별 요약(총/차단/차단율/지연), 일별 추세 차트, 차단 사유(룰)·패널·마스킹·사용자별 차단 Top 분포, 최근 감사 로그 뷰어
- **제어판 탭**: 가드 기능 on/off(7종), 임계치(입력 글자수·인젝션 점수·rate limit), PII 입력 차단 대상 유형 — **런타임 조정** (저장 즉시 캐시 무효화, 다음 요청부터 반영)
- **설정 저장소**: `models/GuardConfig.ts` (싱글톤) · `lib/guardrails/config.ts` (`getGuardConfig()`, 캐시 TTL 30초, DB 실패 시 기본값 fail-open)
- **API** (모두 admin 전용): `GET /api/admin/guardrails/stats` · `GET /api/admin/guardrails/logs` · `GET·PUT /api/admin/guardrails/config`

게이트웨이(`guardedChat`)는 매 호출 시 `getGuardConfig()`로 현재 설정을 읽어 각 가드의 활성화·임계치를 적용한다. 제어판에서 끈 가드는 해당 단계를 건너뛴다.

## 7. 미구현·후속 과제

- **인젝션 ML 탐지**: 현재 정규식 점수제. llm-guard의 임베딩 기반 탐지가 필요하면 Python 사이드카로 보강 가능(현재는 룰 기반으로 충분 판단).
- **스트리밍 악성패턴 차단**: 스트리밍 출력은 시크릿·PII는 마스킹하나, 악성코드 패턴 발견 시 중도 차단은 미적용(비스트리밍은 차단). 필요 시 누적 버퍼 판정 추가.
- **Rate limit 분산**: 단일 서버 Mongo TTL 기반. 다중 인스턴스 확장 시 Redis 검토.
