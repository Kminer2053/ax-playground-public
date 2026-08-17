# 폐쇄망 Windows — 소스 업데이트·Python/OCR 적용 가이드

**대상:** WSL 없이 네이티브 Windows 폐쇄망 PC (SecureGate·알약 등)  
**증상:** 문서작성 Python 기동 실패, 광고심의 OCR 안 됨, LLM 호출 후 서버 멈춤  
**원인:** `PYTHON_BIN` / OCR venv 미구성 + Windows UTF-8 코드 미반영 + LLM 타임아웃 없음

> 전체 최초 설치: [`OFFLINE_INSTALL_WINDOWS.md`](OFFLINE_INSTALL_WINDOWS.md)

---

## 이번 반입에 포함되는 코드 변경

| 내용 | 파일(요약) | 비고 |
|------|------------|------|
| Windows Python UTF-8 | `src/lib/pythonBin.ts`, `ocr.ts`, `docs/generate/route.ts`, `tools/ocr/*.py`, `tools/hwpx/scripts/*.py` | 글자 깨짐·HWPX 실패 수정 |
| LLM 타임아웃 120초 | `src/lib/llm.ts` | Ollama hung 시 dev 서버 전체 멈춤 방지 |
| OCR venv 단독 설치 | `infra/offline/setup-ocr-windows.ps1` | **문서·광고심의 공통 Python** |
| 설치 검증 | `infra/offline/verify-windows.ps1` | Node·SWC·Mongo·Python·OCR |
| SWC 진단 | `infra/offline/diagnose-swc-windows.ps1` | SecureGate `.node` 차단 확인 |

**번들(`bundle-win\`)·`node_modules-win.zip` 은 소스만 바꿀 때 재조립 불필요** (의존성 버전 안 바뀐 경우).

---

## 1. 외부망(조립 PC) — USB에 넣을 것

### A. 소스 (필수)

```powershell
cd C:\ax-playground
git pull
# 또는 USB용 압축 (node_modules·.next 제외)
powershell -ExecutionPolicy Bypass -File infra\offline\pack-source-for-usb.ps1
```

### B. bundle-win (Python/OCR 처음 쓸 때만)

이미 폐쇄망 PC에 `infra\offline\bundle-win\ocr\wheelhouse` 가 있으면 **생략**.

```powershell
powershell -ExecutionPolicy Bypass -File infra\offline\fetch-offline-bundle.ps1
# node_modules 변경 시에만:
npm ci
Compress-Archive -Path node_modules -DestinationPath infra\offline\bundle-win\node_modules-win.zip -Force
```

### USB 구성 예

```
USB plasma\offline\bundle-win\     ← OCR 휠·모델·Python MSI (없을 때만)
ax-playground\                     ← 소스 전체 (node_modules·.next 빼고)
```

---

## 2. 폐쇄망 PC — 소스 반영

1. USB 소스를 `C:\ax-playground` 등 **기존 폴더에 덮어쓰기**
2. **가져오지 말 것:** 맥/리눅스 `node_modules\`, `.next\`
3. `node_modules` 는 기존 `node_modules-win.zip`/` 그대로 유지

---

## 3. Python + OCR venv (문서작성·광고심의 핵심)

문서 HWPX·광고 OCR 모두 **`PYTHON_BIN` 하나**를 씁니다.  
`install-offline.ps1` 을 처음 돌릴 때 Python 이 없으면 5단계가 **건너뛰어진** 상태일 수 있습니다.

### 3-1. Python 3.12 설치 (미설치 시)

```powershell
cd C:\ax-playground
Start-Process .\infra\offline\bundle-win\python-3.12.10-amd64.exe `
  -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_launcher=1' -Wait
```

**새 PowerShell 창**을 연 뒤:

```powershell
py -3.12 -c "import sys;print(sys.executable)"
```

### 3-2. OCR venv 구성

```powershell
cd C:\ax-playground
powershell -ExecutionPolicy Bypass -File infra\offline\setup-ocr-windows.ps1
```

성공 시 venv: `C:\axp\ocr\venv\Scripts\python.exe`

(또는 `install-offline.ps1 -OcrOnly`)

---

## 4. `.env.local` 설정 (필수)

```powershell
copy .env.example .env.local
notepad .env.local
```

**아래 줄을 반드시 추가·수정:**

```env
# 문서작성(HWPX) + 광고심의 OCR 공통 — setup-ocr-windows.ps1 경로와 동일
OCR_PROVIDER=python
PYTHON_BIN=C:\axp\ocr\venv\Scripts\python.exe

# Ollama 응답 없을 때 서버 hung 방지 (선택, 기본 120000)
LLM_TIMEOUT_MS=120000

# 내부 LLM (폐쇄망 기존 탑재)
OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_COMPATIBLE_MODEL=gemma4:e2b

MONGODB_URI=mongodb://127.0.0.1:27017/axplayground
SESSION_SECRET=32자_이상_랜덤
ADMIN_ACCESS_KEY=8자_이상
```

> `PYTHON_BIN` 없으면 앱은 `tools\ocr\.venv\Scripts\python.exe` 를 찾는데, 폐쇄망에는 보통 **없음** → 문서·OCR 모두 실패.

---

## 5. Node PATH (SWC)

- **Node 24 MSI** 로 SWC가 풀린 PC: `where node` → `Program Files\nodejs\node.exe` 확인
- 번들 Node만 쓸 때: `$env:Path = "C:\axp\node\node-v22.12.0-win-x64;$env:Path"`

SWC 테스트:

```cmd
node -e "require('@next/swc-win32-x64-msvc'); console.log('SWC OK')"
```

---

## 6. 기동·검증

```powershell
cd C:\ax-playground

# mongod 미기동 시 (재부팅 후)
# C:\axp\mongodb\...\bin\mongod.exe --dbpath C:\axp\data --bind_ip 127.0.0.1 --logpath C:\axp\log\mongod.log

powershell -ExecutionPolicy Bypass -File infra\offline\verify-windows.ps1

npm run dev
```

브라우저 확인:

| 기능 | 확인 |
|------|------|
| DB | `http://127.0.0.1:3000/api/db/status` |
| 문서작성 | `/panel/docs` — HWPX 생성 |
| 광고심의 | `/panel/ad-review` — 도안 OCR·심의 |

---

## 6.5 사규(RAG) DB만 업데이트 — 개정 반영

사규 개정이 있을 때 **DB 전체가 아니라 사규 3컬렉션만**(본문·임베딩·지식그래프) 교체한다. 관리자 설정·가드레일·퀴즈/포인트 등 **운영 누적은 그대로 보존**되며, 교체 전 현재 상태가 자동 백업된다.

**① 외부망(개발 PC)** — 개정본 반영 후 RAG만 내보내기 → USB 반입:
```powershell
# (개정 적재는 관리자 UI '사규 적재' 탭 또는: npm run reg:ingest -- --file "C:\...\계약업무 처리지침.hwp" --category 지침)
powershell -ExecutionPolicy Bypass -File scripts\export-rag-db.ps1
# → data\mongo-snapshot\rag-update-YYYYMMDD\  (≈66MB) 를 USB로
```

**② 폐쇄망(배포 PC)** — 반입 폴더를 리포의 `data\mongo-snapshot\` 아래에 두고:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\update-rag-db.ps1 -Tools "C:\axp\mongodb-tools\bin"
# 덤프 경로 자동 선택(최신 rag-update-*). 수동 지정: -Dump "data\mongo-snapshot\rag-update-YYYYMMDD"
# 대상 DB가 axplayground가 아니면: -Db <이름>
```

**③ 후속**: `$env:MONGODB_URI="mongodb://127.0.0.1:27017/axplayground"; npm run sagyu:build`(좌측 사규 목록 동기화) → 앱 재시작. 롤백은 스크립트가 출력한 `rag-backup-*` 경로로 `mongorestore --drop`.

> Linux/WSL2는 동일 절차의 `scripts/export-rag-db.sh` / `scripts/update-rag-db.sh`. 상세: [`RAG_GRAPHRAG.md`](RAG_GRAPHRAG.md) §12.

---

## 7. 트러블슈팅

| 증상 | 조치 |
|------|------|
| `Python이 없어 HWPX 변환을 할 수 없습니다` | §3 OCR venv + `.env.local` `PYTHON_BIN` |
| 광고심의 OCR 빈 결과만 | `verify-windows.ps1` OCR 항목, `OCR_PROVIDER=python` |
| 한글 깨짐 | **이번 소스 반영 필수** (UTF-8 패치) |
| `npm run dev` 즉시 종료 | SWC — `diagnose-swc-windows.ps1`, Node MSI 또는 IT 화이트리스트 |
| AI·심의 후 전체 멈춤 | `LLM_TIMEOUT_MS` + Ollama 모델 상태 |
| `bundle-win 없음` | USB로 `infra\offline\bundle-win\` 반입 |

---

## 8. 체크리스트 (폐쇄망 담당자용)

- [ ] 소스 USB 반영 (node_modules 유지)
- [ ] Python 3.12 설치
- [ ] `setup-ocr-windows.ps1` 성공
- [ ] `.env.local` — `PYTHON_BIN`, `OCR_PROVIDER`, LLM, Mongo
- [ ] `verify-windows.ps1` FAIL 0
- [ ] `SWC OK` + `npm run dev`
- [ ] 문서작성·광고심의 1회 테스트
