# AX Playground 운영 인프라 — 가드레일 적용 가이드

이 디렉터리는 **운영팀이 서버에 직접 적용**하는 인프라 레벨 가드레일 산출물입니다.
애플리케이션 코드(`src/lib/guardrails/`)와 함께 다중 방어를 구성합니다.

대응 다이어그램: `ax_portal_guardrail_architecture.svg` — GR2(모델), GR2-3(Nginx).

---

## 1. Ollama Modelfile (GR2-1·GR2-2 / M15·M14)

모델 레이어에 시스템 프롬프트와 파라미터 상한을 굽습니다.

```bash
# 1) 베이스 모델명을 운영 환경 실제 모델로 수정
vi ollama/Modelfile.ax            # FROM qwen3:32b  ← 실제 설치 모델로

# 2) 가드레일 모델 생성
ollama create ax-playground -f ollama/Modelfile.ax

# 3) 앱이 이 모델을 쓰도록 .env.local 설정
#    OPENAI_COMPATIBLE_MODEL=ax-playground
#    OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1
```

> **동기화 주의**: `Modelfile.ax`의 `SYSTEM` 블록은
> `src/lib/guardrails/model/system-prompt.ts`의 `SECURITY_PREAMBLE`와 동일해야 합니다.
> 한쪽만 변경하면 다중 방어가 어긋납니다.

## 2. Nginx 보안 설정 (GR2-3 / M16)

모델/서버 정보 유출을 막고 내부 LLM 엔드포인트 외부 노출을 차단합니다.

```bash
cp nginx/security.conf /etc/nginx/conf.d/ax-security.conf
# 기존 server{} 블록에 include 추가:
#   include /etc/nginx/conf.d/ax-security.conf;
nginx -t && systemctl reload nginx
```

## 3. 감사 로그 디렉터리 (M09)

앱이 기록하는 감사 로그 파일과 일일 리포트 경로를 준비합니다.

```bash
# 감사 로그 파일 (앱이 append) — 기본 경로
sudo touch /var/log/axp-audit.log
sudo chown <앱실행계정> /var/log/axp-audit.log
sudo chmod 640 /var/log/axp-audit.log

# 일일 리포트 출력 디렉터리
sudo mkdir -p /data/reports && sudo chown <앱실행계정> /data/reports
```

`.env.local` 관련 설정:
```
AUDIT_LOG_FILE=/var/log/axp-audit.log   # 미설정 시 동일 기본값
AUDIT_LOG_FULL_TEXT=true                       # 입·출력 전문 기록(감리 요건). 끄려면 false
REPORT_DIR=/data/reports
```

## 4. 일일 리포트 cron (M09)

```bash
# 매일 09:00 전일 감사 로그 분석 리포트 생성
crontab -e
0 9 * * * cd /opt/ax-portal && npm run report:audit >> /var/log/axp-report.log 2>&1
```

## 5. 네트워크 격리 점검(체크리스트)

- [ ] MongoDB `127.0.0.1:27017` 루프백 바인딩 (`docker-compose.yml` 반영됨)
- [ ] Ollama `127.0.0.1:11434` 루프백 — `OLLAMA_HOST=127.0.0.1` 환경변수 확인
- [ ] Qdrant(도입 시) `127.0.0.1:6333` 루프백
- [ ] 방화벽 인바운드: 443(직원)·3001(개발자 Gitea)·22(관리자)만 허용, 그 외 차단
- [ ] 외부 인터넷 아웃바운드 차단 — 앱은 외부 API 미사용(로컬 LLM 전용)
