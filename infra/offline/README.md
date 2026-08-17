# 폐쇄망(내부망) 오프라인 설치·배포 가이드

운영 서버는 **인터넷이 차단된 내부망**입니다. 그래서 설치는 항상 **2단계**입니다.

```
[인터넷 되는 조립 머신]              (USB 등으로 반입)            [폐쇄망 운영 서버]
  ① 코드 받기(git)        ──────────────────────────────►   ① 압축 풀기
  ② 번들 조립(fetch)                                          ② 설치(install): Node·Mongo·시드·OCR
  ③ 리포 전체 압축(tar/zip)                                   ③ .env.local 작성
                                                              ④ 빌드·기동(build → start)
```

> **LLM(Ollama)·모델은 반입 대상이 아닙니다** — 이미 폐쇄망(대상 서버 또는 내부 LLM 서버)에 탑재돼 있다는 전제. 앱은 `.env.local`의 `OPENAI_COMPATIBLE_BASE_URL`로 **연결만** 합니다.

---

## 0. 어느 트랙을 쓰나

| 운영 환경 | 트랙 | 번들 | 스크립트 |
|---|---|---|---|
| **Ubuntu 24.04 (amd64) 네이티브** | **리눅스** | `infra/offline/bundle/` | `*.sh` |
| **Windows + WSL2(Ubuntu 24.04)** | **리눅스** (WSL 안에서 전부 실행) | `infra/offline/bundle/` | `*.sh` |
| **네이티브 Windows (WSL 없이)** | **윈도우** | `infra/offline/bundle-win/` | `*.ps1` |

> WSL2를 쓸 수 있으면 **리눅스 트랙이 더 단순**합니다(권장). WSL 없이 Windows로 직접 돌릴 때만 윈도우 트랙.

## 0-1. 무엇이 어디서 오나 (공통)

| 구분 | 출처 | 비고 |
|---|---|---|
| 앱 소스 · `public/fonts` · `public/rhwp_bg.wasm` · `tools/` · `infra/` | **git 리포** | 압축에 포함 |
| **시드 덤프** `data/mongo-snapshot/dump-*` (기관 데이터 적재 후 자체 생성) | **별도 준비** | 공개 리포 미동봉 — 있으면 `mongorestore`로 복원, 없으면 빈 DB로 기동 |
| Node 런타임 · `node_modules` · MongoDB(+tools) · OCR 휠(pymupdf·rapidocr 등)·한국어 모델 | **번들(fetch가 다운로드)** | 플랫폼 의존 대용량 |
| **LLM(Ollama)·모델** | 폐쇄망 기존 탑재 | 반입 안 함 — 연결만 |
| Python 3.12 | 타깃 OS | 리눅스=기본 포함 / 윈도우=번들의 설치본으로 설치 |

> ⚠ **Node는 폐쇄망 전제가 아닙니다.** 우분투/윈도우 모두 Node 미탑재여도 됩니다 — 번들이 Node를 동봉하고 install 스크립트가 설치합니다. (Python 3.12만 우분투는 기본 제공, 윈도우는 설치 필요.)

---

# 트랙 A — 리눅스 (Ubuntu 24.04 / amd64, WSL2 포함)

## A-1. 조립 — [인터넷 되는 Ubuntu 24.04 / amd64 머신]
> 조립 머신은 **운영과 동일 플랫폼**(Ubuntu 24.04·amd64·Python 3.12)이어야 휠·네이티브 바이너리가 맞습니다. 이 머신엔 **Node·npm·Python 3.12·pip**가 있어야 합니다(인터넷 되니 nvm/apt로 설치 가능).

```bash
git clone <repo> ax-playground && cd ax-playground
bash infra/offline/fetch-offline-bundle.sh
#   → infra/offline/bundle/ 에 생성:
#     node-vXX-linux-x64.tar.xz · node_modules.tgz(npm ci, xlsx 등 포함)
#     mongodb-*.tgz + database-tools · ocr/wheelhouse(pymupdf·rapidocr·opencv-headless)
#     ocr/models_cache(한국어 PP-OCRv5)
tar czf ../ax-playground-bundle.tgz .     # ★ 리포 전체를 tar 로 압축(번들 폴더 포함)
```
> **반드시 `tar`(작업트리 통째)로 압축하세요.** `git archive`를 쓰면 `.gitignore` 대상인 `infra/offline/bundle/`가 빠집니다.

## A-2. 반입
`ax-playground-bundle.tgz`를 USB 등으로 폐쇄망 운영 서버로 옮깁니다.

## A-3. 설치 — [폐쇄망 운영 서버]
```bash
sudo mkdir -p /opt/ax-playground && cd /opt/ax-playground
tar xzf /mnt/usb/ax-playground-bundle.tgz
bash infra/offline/install-offline.sh
#   1/5 Node 설치(/opt/node)   2/5 node_modules 복원
#   3/5 MongoDB 설치+기동(127.0.0.1, --fork)   4/5 시드 덤프 복원(mongorestore --drop dump-*)
#   5/5 OCR venv(/opt/axp/ocr/venv, 오프라인 휠+모델)
```
> 멱등하지 않습니다 — 1회 실행 권장. Docker로 Mongo를 쓰려면 스크립트 주석의 `docker load`/`docker compose` 경로 참고.
> WSL2는 systemd 기본 비활성 → 스크립트 기본 `mongod --fork`로 충분(서비스 등록하려면 `/etc/wsl.conf`에 `systemd=true`).

## A-4. 환경 변수
```bash
cp .env.example .env.local && vi .env.local
```
| 변수 | 값 |
|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` |
| `MONGODB_DB` | `axplayground` |
| `SESSION_SECRET` | 32자 이상 랜덤 |
| `ADMIN_ACCESS_KEY` | 8자 이상 |
| `OPENAI_COMPATIBLE_BASE_URL` | `http://<내부 LLM>:11434/v1` |
| `OPENAI_COMPATIBLE_MODEL` | `ax-playground`(또는 탑재 모델명) |
| `OCR_PROVIDER` / `PYTHON_BIN` | `python` / `/opt/axp/ocr/venv/bin/python` |

## A-5. 빌드·기동
```bash
npm run build      # 사규 sagyu.json 생성 + next build (Mongo 복원 이후 실행)
npm run start      # http://127.0.0.1:3000
# 권장: systemd 등록(docs/OFFLINE_INSTALL.md §5)
```

> 상세: [`../../docs/OFFLINE_INSTALL.md`](../../docs/OFFLINE_INSTALL.md)

> `bundle/` 산출물은 대용량이라 git에 커밋하지 않습니다(`.gitignore` 처리).

---

# 트랙 B — 네이티브 Windows (WSL 없이)

## B-1. 조립 — [인터넷 되는 Windows (amd64)]
> 조립 머신엔 **Node·npm·Python 3.12**가 있어야 합니다.

```powershell
git clone <repo> ax-playground ; cd ax-playground
powershell -ExecutionPolicy Bypass -File infra\offline\fetch-offline-bundle.ps1
#   → infra\offline\bundle-win\ 에 생성:
#     node-v*-win-x64.zip · mongodb-windows-*.zip + tools · python-3.12.x-amd64.exe
#     ocr\wheelhouse(win_amd64/cp312: pymupdf·rapidocr·opencv-headless) · ocr\models_cache

# ★ node_modules 는 fetch 가 만들지 않음 — Windows 에서 직접 빌드해 넣어야 함(네이티브 바이너리)
npm ci
Compress-Archive -Path node_modules -DestinationPath infra\offline\bundle-win\node_modules-win.zip -Force
```
> `npm ci`가 사내 프록시에 막히면 사내 npm 미러를 쓰거나, 인터넷 되는 다른 Windows에서 만들어 가져옵니다.

## B-2. 반입
`bundle-win\`(+ `node_modules-win.zip`)을 포함한 **리포 전체**를 USB로 폐쇄망 Windows에 복사(예: `C:\ax-playground\`).
> ⚠ **맥/리눅스의 `node_modules\`·`.next\`는 가져오지 마세요**(OS·아키텍처 불일치). node_modules는 `node_modules-win.zip`으로만 반입합니다.

## B-3. 설치 — [폐쇄망 Windows] (관리자 PowerShell 권장)
```powershell
cd C:\ax-playground
powershell -ExecutionPolicy Bypass -File infra\offline\install-offline.ps1
#   1/5 Node(C:\axp\node)   2/5 node_modules-win.zip 복원
#   3/5 MongoDB 기동(127.0.0.1, Start-Process)   4/5 시드 덤프 복원(mongorestore --drop dump-*)
#   5/5 OCR venv(C:\axp\ocr\venv) — Python 3.12 있을 때
```
**Python 3.12가 없으면** OCR 5단계를 건너뜁니다. OCR까지 쓰려면 먼저 설치 후 스크립트 재실행:
```powershell
Start-Process .\infra\offline\bundle-win\python-3.12.10-amd64.exe `
  -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_launcher=1' -Wait
```
(OCR 불필요 시 `.env.local`에 `OCR_PROVIDER=none`)

## B-4. 환경 변수
```powershell
copy .env.example .env.local   # 후 편집
```
리눅스 표와 동일. 단 `PYTHON_BIN=C:\axp\ocr\venv\Scripts\python.exe`.

## B-5. 기동
```powershell
npm run build ; npm run start    # 운영형(권장). http://127.0.0.1:3000
# (빠른 확인용은 npm run dev)
```
> 상시 운영: MongoDB·앱을 NSSM 등으로 **Windows 서비스 등록**(재부팅 자동 기동). 상세: [`../../docs/OFFLINE_INSTALL_WINDOWS.md`](../../docs/OFFLINE_INSTALL_WINDOWS.md)

## B-6. Windows 보조 스크립트

| 스크립트 | 용도 |
|----------|------|
| `fetch-offline-bundle.ps1` | bundle-win 조립 |
| `install-offline.ps1` | 전체 설치 (`-OcrOnly` OCR만) |
| `setup-ocr-windows.ps1` | Python OCR venv (문서·광고심의) |
| `verify-windows.ps1` | 설치 검증 |
| `build-windows-patch.ps1` | USB용 패치 zip |
| `diagnose-swc-windows.ps1` | SWC/SecureGate 진단 |

업데이트: [`../../docs/CLOSED_NETWORK_WINDOWS_UPDATE.md`](../../docs/CLOSED_NETWORK_WINDOWS_UPDATE.md)  
GitHub↔Gitea bundle 동기화: [`../../docs/CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](../../docs/CLOSED_NETWORK_GIT_BUNDLE_SYNC.md)

---

## 공통 마무리 (양 트랙)

1. **LLM 가드레일 모델** — `ax-playground`가 없으면 LLM 서버에서 `ollama create ax-playground`(`infra/ollama/Modelfile.ax`), 있으면 `OPENAI_COMPATIBLE_MODEL`만 그 이름으로.
2. **가드레일 인프라** — nginx 보안설정·감사로그·일일 리포트 cron: [`../README.md`](../README.md).
3. **검증** — `curl -I http://127.0.0.1:3000`(200) · `mongosh axplayground --eval "db.rag_regulation.countDocuments()"`(**104**) · 지식검색/광고심의(OCR)/안전(비전)/`/admin` 동작 · 감사로그 누적.
4. **네트워크 격리** — Mongo 127.0.0.1 바인딩 · 방화벽 인바운드 443·22만 · 외부 아웃바운드 차단(앱은 외부 API 미사용).

## 자주 막히는 곳

| 증상 | 원인·해결 |
|---|---|
| 번들이 비어 반입됨 | `git archive` 대신 **`tar`(작업트리)** 로 압축. `bundle*/`는 `.gitignore`라 git에는 없음 |
| Windows에서 `node_modules-win.zip 없음` | Windows에서 `npm ci` → `Compress-Archive`로 생성(B-1). 리눅스/맥 node_modules 재사용 금지 |
| 휠/모듈 ABI 불일치 | 조립 머신 = 타깃과 **동일 OS·amd64·Python 3.12**. 리눅스 휠↔윈도우 휠 혼용 금지 |
| OCR 결과 빈값 | `PYTHON_BIN` 경로 · `opencv-python-headless` 설치 · 모델 캐시 존재 |
| 빌드 시 사규 단계 실패 | Mongo 기동·복원 **후** `npm run build`(빌드가 DB 참조) |
| AI 응답 없음 | `OPENAI_COMPATIBLE_BASE_URL` 도달·방화벽, `OPENAI_COMPATIBLE_MODEL` 이름 일치 |
| 시드 덤프 2개 공존 | `data/mongo-snapshot/`엔 **덤프 1개만**(install이 `dump-*` 글롭/첫 디렉터리 복원) |

## 갱신 배포(증분)

**소스(Git)만** GitHub→내부 Gitea로 맞출 때(커밋 해시 동일):  
시스템 담당자 안내 [`docs/CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md`](../../docs/CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md) · 실무 [`docs/CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](../../docs/CLOSED_NETWORK_GIT_BUNDLE_SYNC.md)  
(`infra/offline/export-git-bundle-incremental.ps1` / `apply-git-bundle-incremental.bat`)

**런타임 번들**(Node·`node_modules`·Mongo·OCR)까지 다시 맞출 때:  
조립 머신에서 `git pull` → (DB 시드가 바뀌었으면) `mongodump`로 `data/mongo-snapshot/dump-<날짜>` 재생성([`../../data/mongo-snapshot/README.md`](../../data/mongo-snapshot/README.md)) → 번들 재조립(fetch) → 반입 → 폐쇄망에서 `mongorestore --drop` + `npm run build` + 재기동. 의존성(`package.json`·`requirements.txt`)이 바뀌었으면 번들 재조립이 필수입니다.
