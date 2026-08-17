# 폐쇄망 Linux 서버 — 소스·RAG DB 업데이트 작업 안내서

**대상:** 이미 AX Playground가 운영 중인 **Ubuntu 24.04 LTS (amd64)** 내부망 서버  
**목적:** 금번 릴리스(`main` ≥ `483e80c`)를 반영하되, **운영 DB의 관리자 설정·가드레일·콘텐츠는 유지**하고 **RAG 3컬렉션만 교체**  
**작성 기준 커밋:** `54decf4` (안내서) · 코드 변경 범위 `2a75268` → `483e80c`

> 최초 설치(빈 서버): [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md) · 반입 원리: [`infra/offline/README.md`](../infra/offline/README.md)  
> GitHub↔Gitea 동기화 — 담당자 안내: [`CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md`](CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md) · 실무 bundle: [`CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md)

---

## 0. 금번 업데이트 주요 내용

작업 후 사용자·운영자에게 달라지는 점입니다.

| 영역 | 내용 |
|------|------|
| **지식검색(RAG)** | 표 성격 4분류·A기준표 행 명제(`tableGloss`)·검색 배선(조문가산·표해석·금액 구간산술 등). 시드 **`dump-2026-07-04`** |
| **임베딩** | BGE-M3 **OpenAI `/v1/embeddings` 자동 분기** — `OLLAMA_EMBEDDING_BASE_URL`에 `/v1` 포함 시 `:8001` FastAPI 등과 연동 |
| **문서작성** | **kordoc 3.11**, HWPX 임의양식 편집계획(P1~P4)·실서식 품질 루프, 사이드챗(지식검색급)·첨부 인덱싱(파일당 ≤30만자) |
| **사규 적재(관리자)** | 내용변경 감지·인라인 diff·시행일 자동·증분 재사용, CLI `npm run reg:ingest` |
| **배포·운영** | `scripts/update-rag-db.sh`·`export-rag-db.sh` 보강, 관리자 **RAG 캐시 새로고침** API(무중단 DB 반영) |
| **관리자 보안** | **관리자 IP 허용 목록** (`ADMIN_ALLOWED_IPS` env 또는 관리자 설정). 미설정 시 기존과 동일(제한 없음) |
| **의존성** | `package.json` / `package-lock.json` 변경(**kordoc 3.11** 등) → **`node_modules` 재조립 필수** |

### DB 교체 범위 (이번 작업)

| 교체 (`--drop` 해당 컬렉션만) | 보존 |
|-------------------------------|------|
| `rag_regulation` · `rag_vectors` · `rag_graph_edges` | `playgroundconfigs`(관리자키 해시·LLM 설정) · `guardconfigs` · 퀴즈·라이브러리·감사로그 등 |

복원 후 기대 건수(검증용):

| 컬렉션 | 건수 |
|--------|------|
| `rag_regulation` | 103 |
| `rag_vectors` | 4,317 |
| `rag_graph_edges` | 2,844 |

---

## 1. 반입 대상 — **변경된 파일만** (증분)

이전 내부망 배포가 **`2a75268`(GraphRAG 반영분)** 이고, 이번에 **`483e80c` 이상**으로 올릴 때 **USB·반입에 넣을 것**만 정리합니다.  
리포 전체를 다시 옮길 필요는 **없습니다**.

### 1-1. 필수 반입 (체크리스트)

| # | 구분 | 경로 | 비고 |
|---|------|------|------|
| ① | **의존성** | `package.json` · `package-lock.json` | lock 변경(kordoc 3.11) |
| ② | **node_modules/** | 통째 (Linux amd64) | 개별 파일 아님 · `npm ci` 결과물 |
| ③ | **앱 소스** | 아래 §1-2 목록 (47개) | `src/` 변경분만 |
| ④ | **정적·데이터** | `public/sagyu.json` · `data/table-overrides.json` | 빌드·표QA |
| ⑤ | **RAG 덤프** | 아래 §1-3 (6개) | DB는 **3컬렉션만** 교체 |
| ⑥ | **배포 스크립트** | `scripts/update-rag-db.sh` · `scripts/export-rag-db.sh` (+ `.ps1` 2개) | |
| ⑦ | **작업 안내** | `docs/CLOSED_NETWORK_LINUX_UPDATE.md` | 이 문서 |

> **반입하지 않음:** `.next/`(서버에서 빌드) · `.env.local`(서버 기존 유지) · Windows `node_modules/`

### 1-2. 앱 소스 변경 목록 (`src/` 등 47개)

```
package.json
package-lock.json
public/sagyu.json
data/table-overrides.json
data/mongo-snapshot/README.md
scripts/export-rag-db.sh
scripts/export-rag-db.ps1
scripts/update-rag-db.sh
scripts/update-rag-db.ps1
src/app/api/admin/auth/route.ts
src/app/api/admin/rag-cache/route.ts                    ← 신규
src/app/api/admin/regulations/ingest/route.ts
src/app/api/admin/settings/route.ts
src/app/api/ai/chat/attach/route.ts                   ← 신규
src/app/api/ai/chat/route.ts
src/app/api/docs/generate/route.ts
src/app/api/docs/parse/route.ts
src/app/api/knowledge/assistant/route.ts
src/components/admin/tabs/RegulationIngestTab.tsx
src/components/admin/tabs/SettingsTab.tsx
src/components/panels/desktop/PanelDocs.tsx
src/lib/adminAuth.ts
src/lib/adminIp.ts                                    ← 신규
src/lib/chat-attachments.ts                           ← 신규
src/lib/embedding.ts
src/lib/env.ts
src/lib/hwpx-edit-plan.ts                             ← 신규
src/lib/playgroundConfig.ts
src/lib/regulations-extract.ts
src/lib/regulations-graph-build.ts
src/lib/regulations-ingest.ts
src/lib/regulations-rag.ts
src/lib/regulations-retrieve.ts
src/lib/regulations-search.ts                         ← 신규
src/lib/regulations-table-classify.ts                 ← 신규
src/lib/regulations-table-gloss.ts                    ← 신규
src/lib/regulations-table-retag.ts                    ← 신규
src/lib/regulations-vector.ts
src/models/RagRegulation.ts
src/scripts/build-embeddings.ts
src/scripts/build-sagyu.ts                            ← 신규
src/scripts/build-table-gloss.ts                      ← 신규
src/scripts/classify-tables.ts                        ← 신규
src/scripts/eval-ab-answers.ts                        ← 신규 (운영 비필수)
src/scripts/eval-ab-mixed.ts                          ← 신규 (운영 비필수)
src/scripts/eval-form-corpus.ts                       ← 신규 (운영 비필수)
src/scripts/eval-table-gold.ts                        ← 신규 (운영 비필수)
src/scripts/gen-table-queries.ts                      ← 신규 (운영 비필수)
src/scripts/ingest-regulation.ts                      ← 신규
```

`src/scripts/eval-*` · `gen-table-queries` 는 **운영 서버 필수는 아님**(개발·평가용). USB 용량이 부족하면 ③에서 제외 가능.

### 1-3. RAG DB 반입 — **3컬렉션 BSON만** (6개)

`update-rag-db.sh` 가 요구하는 최소 덤프입니다. 덤프 폴더 **나머지 15컬렉션은 반입 불필요**(RAG만 교체하므로).

```
data/mongo-snapshot/dump-2026-07-04/axplayground/rag_regulation.bson
data/mongo-snapshot/dump-2026-07-04/axplayground/rag_regulation.metadata.json
data/mongo-snapshot/dump-2026-07-04/axplayground/rag_vectors.bson
data/mongo-snapshot/dump-2026-07-04/axplayground/rag_vectors.metadata.json
data/mongo-snapshot/dump-2026-07-04/axplayground/rag_graph_edges.bson
data/mongo-snapshot/dump-2026-07-04/axplayground/rag_graph_edges.metadata.json
```

### 1-4. 선택 반입 (참고·문서)

운영 동작에는 필수 아님. 여유 있을 때만.

| 경로 | 용도 |
|------|------|
| `docs/RAG_GRAPHRAG.md` | RAG·임베딩 참고 |
| `data/benchmark/ab-sample-50.json` · `table-queries.json` | 표QA 평가셋 |
| `README.md` · `docs/PROJECT_OVERVIEW.md` 등 | 문서 현행화 |

### 1-5. 조립 PC에서 변경분만 묶기 (경로 B용)

```bash
PREV=2a75268
NEW=483e80c
cd ax-playground && git fetch && git checkout main && git pull
git rev-parse --short HEAD    # $NEW 이상

# 변경 파일 목록 (구 덤프 삭제·평가셋 제외)
git diff $PREV..$NEW --name-only --diff-filter=ACMR \
  | grep -v '^data/mongo-snapshot/dump-2026-06-25' \
  | grep -v '^data/benchmark/' \
  | grep -v '^docs/reverse-engineering/' \
  > /tmp/ax-update-files.txt

# 소스·데이터·스크립트 증분 tar (기존 APP_ROOT 위에 덮어쓰기)
tar czf ax-update-src-$(date +%Y%m%d).tgz -T /tmp/ax-update-files.txt

# RAG BSON만 따로 (위 목록에 이미 포함돼 있으면 생략 가능)
tar czf ax-update-rag-$(date +%Y%m%d).tgz \
  data/mongo-snapshot/dump-2026-07-04/axplayground/rag_regulation.bson \
  data/mongo-snapshot/dump-2026-07-04/axplayground/rag_regulation.metadata.json \
  data/mongo-snapshot/dump-2026-07-04/axplayground/rag_vectors.bson \
  data/mongo-snapshot/dump-2026-07-04/axplayground/rag_vectors.metadata.json \
  data/mongo-snapshot/dump-2026-07-04/axplayground/rag_graph_edges.bson \
  data/mongo-snapshot/dump-2026-07-04/axplayground/rag_graph_edges.metadata.json

# 의존성 (항상 별도)
npm ci
tar czf ax-update-node_modules-$(date +%Y%m%d).tgz node_modules
```

**USB 구성 (최소 3개)**

| 파일 | 내용 |
|------|------|
| `ax-update-src-*.tgz` (또는 `.zip`) | §1-2·§1-3 변경 소스·RAG BSON |
| `ax-update-node_modules-*.tgz` | **Linux** `node_modules` (WSL/Ubuntu에서 `npm ci`) |
| (선택) `docs/CLOSED_NETWORK_LINUX_UPDATE.md` | 단독 복사 가능 |

### 1-6. 조립 PC — **Windows (PowerShell)** 명령

외부망 **Windows PC**에서 USB를 만들 때 사용합니다.  
**Linux 운영 서버용 `node_modules`는 Windows `npm ci` 결과를 쓸 수 없습니다.** → **WSL Ubuntu** 또는 별도 Linux 조립 PC에서 §1-5의 `npm ci`·tar를 수행하세요.

```powershell
# 리포 루트 (경로는 환경에 맞게)
cd C:\ax-playground

$PREV = "2a75268"
$NEW  = "483e80c"
$date = Get-Date -Format "yyyyMMdd"

git fetch origin
git pull origin main
git rev-parse --short HEAD   # $NEW 이상인지 확인

# 변경 파일 목록 (구 덤프·평가셋·리버스엔지 문서 제외)
$listFile = "$env:TEMP\ax-update-files.txt"
git diff "$PREV..$NEW" --name-only --diff-filter=ACMR |
  Where-Object { $_ -notmatch '^data/mongo-snapshot/dump-2026-06-25' } |
  Where-Object { $_ -notmatch '^data/benchmark/' } |
  Where-Object { $_ -notmatch '^docs/reverse-engineering/' } |
  Set-Content -Path $listFile -Encoding utf8

# 변경분만 스테이징 후 zip
$root  = (Get-Location).Path
$stage = "$env:TEMP\ax-update-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Get-Content $listFile | ForEach-Object {
  $rel = $_.Trim()
  if (-not $rel) { return }
  $src = Join-Path $root $rel
  if (-not (Test-Path $src)) { return }
  $dest = Join-Path $stage $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
  Copy-Item $src $dest -Force
}

$srcZip = "infra\offline\ax-update-src-$date.zip"
if (Test-Path $srcZip) { Remove-Item $srcZip -Force }
Compress-Archive -Path "$stage\*" -DestinationPath $srcZip -Force
Remove-Item $stage -Recurse -Force
Write-Host "[OK] $srcZip"

# RAG BSON 6개만 따로 zip (선택 — src zip에 이미 포함돼 있으면 생략)
$ragZip = "infra\offline\ax-update-rag-$date.zip"
$ragPaths = @(
  "data\mongo-snapshot\dump-2026-07-04\axplayground\rag_regulation.bson",
  "data\mongo-snapshot\dump-2026-07-04\axplayground\rag_regulation.metadata.json",
  "data\mongo-snapshot\dump-2026-07-04\axplayground\rag_vectors.bson",
  "data\mongo-snapshot\dump-2026-07-04\axplayground\rag_vectors.metadata.json",
  "data\mongo-snapshot\dump-2026-07-04\axplayground\rag_graph_edges.bson",
  "data\mongo-snapshot\dump-2026-07-04\axplayground\rag_graph_edges.metadata.json"
)
$ragStage = "$env:TEMP\ax-update-rag-stage"
if (Test-Path $ragStage) { Remove-Item $ragStage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ragStage | Out-Null
foreach ($rel in $ragPaths) {
  $src = Join-Path $root ($rel -replace '\\','/')
  if (-not (Test-Path $src)) { throw "없음: $rel" }
  $dest = Join-Path $ragStage $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
  Copy-Item $src $dest -Force
}
if (Test-Path $ragZip) { Remove-Item $ragZip -Force }
Compress-Archive -Path "$ragStage\*" -DestinationPath $ragZip -Force
Remove-Item $ragStage -Recurse -Force
Write-Host "[OK] $ragZip"
```

**Linux용 `node_modules` — WSL Ubuntu에서 (Windows PC에 WSL 있는 경우)**

```powershell
# PowerShell에서 WSL 호출 (리포가 C:\ax-playground 일 때, $date는 위에서 정의)
wsl -e bash -lc "cd /mnt/c/ax-playground && npm ci && tar czf infra/offline/ax-update-node_modules-${date}.tgz node_modules"
```

WSL이 없으면 **Ubuntu 조립 PC**에서 §1-5 Linux 명령으로 `node_modules` tar를 만듭니다.

**한 번에 묶기 (권장)** — OS 의존 파일 제외 zip:

```powershell
cd C:\ax-playground
powershell -ExecutionPolicy Bypass -File infra\offline\pack-update-internal.ps1
# → infra\offline\ax-update-internal-YYYYMMDD.zip
#    (변경 소스 + package.json/lock + RAG BSON 6개 + INTERNAL_UPDATE_README.txt)
```

수동으로 §1-6 블록을 실행해도 동일합니다.

**내부망 Linux 서버에서 zip 풀기**

```bash
export APP_ROOT=/opt/ax-playground
cd "$APP_ROOT"
unzip -o /mnt/usb/ax-update-src-YYYYMMDD.zip
# node_modules 는 .tgz 그대로: tar xzf ax-update-node_modules-YYYYMMDD.tgz -C "$APP_ROOT"
```

**참고 — 네이티브 Windows 폐쇄망 PC 자체를 업데이트할 때** (Linux 서버 아님):  
[`CLOSED_NETWORK_WINDOWS_UPDATE.md`](CLOSED_NETWORK_WINDOWS_UPDATE.md) · `node_modules-win.zip` · `scripts\update-rag-db.ps1`

---

## 2. 작업 전 점검

```bash
# 앱 경로(예시 — 실제 경로로 바꿀 것)
export APP_ROOT=/opt/ax-playground   # 또는 /opt/ax-portal-src

node -v          # v20~22 권장 (조립·운영 동일 메이저)
mongosh --version
systemctl status mongod 2>/dev/null || pgrep mongod

# Mongo·LLM·임베딩 도달 (IP는 환경에 맞게)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000
curl -s http://<AILLM>:11434/v1/models | head -c 120
curl -s http://<AILLM>:8001/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3","input":["테스트"]}' | head -c 120
```

**백업 권장**

```bash
cp -a "$APP_ROOT/.env.local" "$APP_ROOT/.env.local.bak.$(date +%Y%m%d)"
# RAG 스크립트가 교체 전 자동 백업도 수행함 (data/mongo-snapshot/rag-backup-*)
```

---

## 3. 반입·적용 — 두 가지 경로

운영 서버와 **동일 OS·아키텍처(Ubuntu 24.04 amd64)** 를 맞추는 것이 원칙입니다.  
`node_modules`는 **Linux용**이어야 하며, Windows에서 만든 것은 **사용 불가**합니다.

### 경로 A — 내부망 서버에 인터넷 연결 가능 (일시 창)

인터넷 개방 창에서 아래를 **운영 서버(`$APP_ROOT`)에서 직접** 실행합니다.

```bash
cd "$APP_ROOT"

# 1) 소스 갱신
git fetch origin && git checkout main && git pull origin main
git rev-parse --short HEAD    # 483e80c 이상 확인

# 2) 의존성 (package-lock 변경됨 — 반드시 재설치)
npm ci

# 3) RAG DB만 교체 (§5 참고)
bash scripts/update-rag-db.sh data/mongo-snapshot/dump-2026-07-04

# 4) 환경 변수 점검 (§6)
vi .env.local

# 5) 빌드·재기동 (§7)
npm run build
sudo systemctl restart ax-playground   # 또는: pm2 restart ax-portal
```

> 인터넷 창이 닫히면 외부 차단을 복구합니다. 이후에는 경로 B와 동일하게 오프라인 운영.

---

### 경로 B — 완전 폐쇄망 (인터넷 되는 동일환경 조립 PC → USB 반입)

#### B-1. 조립 PC (Ubuntu 24.04 amd64, 인터넷 가능)

**§1-5** 명령으로 변경분만 tar 생성합니다. (리포 전체 압축 불필요)

```bash
PREV=2a75268
NEW=483e80c
cd ax-playground && git pull origin main
git rev-parse --short HEAD    # $NEW 이상

git diff $PREV..$NEW --name-only --diff-filter=ACMR \
  | grep -v '^data/mongo-snapshot/dump-2026-06-25' \
  | grep -v '^data/benchmark/' \
  | grep -v '^docs/reverse-engineering/' \
  > /tmp/ax-update-files.txt

tar czf ax-update-src-$(date +%Y%m%d).tgz -T /tmp/ax-update-files.txt

npm ci
tar czf ax-update-node_modules-$(date +%Y%m%d).tgz node_modules
```

**USB에 넣을 것**

| 파일 | 필수 | 내용 |
|------|:----:|------|
| `ax-update-src-*.tgz` | ✅ | §1-2 소스 + §1-3 RAG BSON 6개 + package.json 등 |
| `ax-update-node_modules-*.tgz` | ✅ | Ubuntu amd64 `npm ci` 결과 |
| `.env.local` | ❌ | 서버 기존 유지 |

#### B-2. 폐쇄망 운영 서버

```bash
export APP_ROOT=/opt/ax-playground
cd "$APP_ROOT"

# 1) 변경 소스만 덮어쓰기 (.env.local 유지)
tar xzf /mnt/usb/ax-update-src-YYYYMMDD.tgz -C "$APP_ROOT"

# 2) node_modules 교체
rm -rf node_modules
tar xzf /mnt/usb/ax-update-node_modules-YYYYMMDD.tgz -C "$APP_ROOT"

# 3) RAG DB만 교체
bash scripts/update-rag-db.sh data/mongo-snapshot/dump-2026-07-04

# 4) .env.local 점검 (§6)
vi .env.local

# 5) 빌드·재기동 (§7)
npm run build
sudo systemctl restart ax-playground
```

> `git`이 운영 서버에 없어도 경로 B로 배포 가능합니다.

---

## 4. `npm ci` vs `node_modules` 복사

| 상황 | 방법 |
|------|------|
| 운영 서버에서 **인터넷·npm 가능** (경로 A) | `npm ci` |
| **폐쇄망** (경로 B) | 조립 PC에서 `npm ci` → **`node_modules` tar 반입** |
| 사내 npm 미러만 있음 | 운영 서버에서 `npm ci` 가능(미러 URL 설정 필요) |

이번 릴리스는 **`package-lock.json`이 변경**되었으므로, 기존 `node_modules`를 그대로 두면 **빌드 실패·문서작성(kordoc) 오류**가 날 수 있습니다.

---

## 5. RAG DB만 교체 (필수)

전체 `mongorestore --drop data/mongo-snapshot/dump-*` 는 **관리자 설정(`playgroundconfigs`)까지 덮어쓰므로 기존 운영 서버에서는 사용하지 마세요.**

```bash
cd "$APP_ROOT"

# MongoDB 기동 확인
mongosh "mongodb://127.0.0.1:27017" --eval 'db.runCommand({ping:1})'

# 도구 경로 (PATH에 없을 때)
# export MONGO_TOOLS=/usr/bin   # mongorestore 위치

bash scripts/update-rag-db.sh data/mongo-snapshot/dump-2026-07-04
```

스크립트가 하는 일:

1. 현재 `rag_regulation` · `rag_vectors` · `rag_graph_edges` → `data/mongo-snapshot/rag-backup-날짜/` 백업  
2. 덤프에서 **위 3컬렉션만** `--drop` 복원  
3. `mongosh` 있으면 건수 출력  

**롤백**

```bash
# 스크립트 종료 시 안내된 BK 경로 사용
mongorestore --uri="mongodb://127.0.0.1:27017" --drop data/mongo-snapshot/rag-backup-YYYYMMDD-HHMMSS
```

---

## 6. `.env.local` 설정 (업데이트 후 확인)

서버의 **기존 `.env.local`을 유지**하고, 아래 항목만 **추가·수정**합니다.  
(`SESSION_SECRET` · `ADMIN_ACCESS_KEY`는 이미 있으면 **바꾸지 마세요** — 세션·관리자 해시가 깨집니다.)

```bash
vi "$APP_ROOT/.env.local"
```

### 6-1. 필수 (기존 값 유지 + 임베딩 갱신)

```env
# ── 기존 유지 ──
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=axplayground
SESSION_SECRET=<기존 32자 이상 값 유지>
ADMIN_ACCESS_KEY=<기존 값 유지>

# 채팅 LLM (AILLM Ollama 등)
OPENAI_COMPATIBLE_BASE_URL=http://<AILLM>:11434/v1
OPENAI_COMPATIBLE_MODEL=<운영 모델명>
OPENAI_COMPATIBLE_API_KEY=ollama

# ── 금번 업데이트: 임베딩 (BGE-M3, /v1 자동 분기) ──
OLLAMA_EMBEDDING_BASE_URL=http://<AILLM>:8001/v1
OLLAMA_EMBEDDING_MODEL=bge-m3
EMBEDDING_DIMENSIONS=1024
```

> `OLLAMA_EMBEDDING_BASE_URL`에 **`/v1`이 포함**되면 OpenAI 호환 엔드포인트로 호출합니다.  
> Ollama 네이티브(`http://<AILLM>:11434`)만 쓰는 환경이면 `/v1` 없이 설정하고, 모델이 Ollama에 `bge-m3`로 떠 있어야 합니다.

### 6-2. OCR·문서작성 (기존과 동일, 경로만 확인)

```env
OCR_PROVIDER=python
PYTHON_BIN=/opt/axp/ocr/venv/bin/python
# 또는 install-offline.sh 기준: /opt/ax-playground/ocr/venv/bin/python
```

### 6-3. 선택

```env
# 관리자 IP 제한 (비우면 제한 없음). 콤마 구분, CIDR 가능.
# ADMIN_ALLOWED_IPS=192.168.10.0/24,10.0.0.50

# 감사 로그
# AUDIT_LOG_FILE=/var/log/axp-audit.log

# LLM 부하 조절 (내부 GPU 용량에 맞게)
# LLM_MAX_CONCURRENCY=8
# LLM_TIMEOUT_MS=180000
```

### 6-4. 관리자 IP 제한 사용 시 주의

- 목록이 **비어 있지 않으면**, 허용 IP가 아닌 PC에서는 관리자 API가 거부됩니다.  
- **서버 본机(localhost)** 는 항상 허용(복구 경로).  
- Nginx 뒤에서는 `proxy_set_header X-Forwarded-For $remote_addr;` 등으로 클라이언트 IP가 전달되어야 합니다.

### 6-5. 적용

```bash
# .env.local 변경 후 앱 재시작 필수
sudo systemctl restart ax-playground
# 또는: pm2 restart ax-portal
```

---

## 7. 빌드·기동·RAG 반영

```bash
cd "$APP_ROOT"

# Mongo 기동 상태에서 (sagyu.json 생성 + next build)
npm run build

# 프로세스 재시작
sudo systemctl restart ax-playground
# 또는: pm2 restart ax-portal && pm2 save
```

**RAG DB만 바꾼 뒤 앱을 재시작하지 않았다면**, 관리자 페이지 → **설정** 탭 → **[RAG 캐시 새로고침]** 버튼으로 인메모리 벡터·BM25 캐시를 비울 수 있습니다. (재시작과 동일 효과)

**좌측 사규 목록(`public/sagyu.json`)** 은 이번 배포 소스에 포함되어 있으면 추가 작업 불필요합니다. DB만 반영하고 목록이 어긋나면:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017 npm run sagyu:build
npm run build   # sagyu 반영 후
```

---

## 8. 검증 체크리스트

```bash
# HTTP
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000

# DB (mongosh)
mongosh "mongodb://127.0.0.1:27017/axplayground" --eval '
  print("rag_regulation:", db.rag_regulation.countDocuments());
  print("rag_vectors:", db.rag_vectors.countDocuments());
  print("rag_graph_edges:", db.rag_graph_edges.countDocuments());
'
```

| # | 확인 항목 | 기대 |
|---|-----------|------|
| 1 | 메인 이미지맵 로드 | 200 |
| 2 | RAG 건수 | 103 / 4317 / 2844 |
| 3 | 지식검색 — 사규 질의·근거 인용 | 응답 + 출처 |
| 4 | 지식검색 — 표 관련 질의(금액·기준표) | 개선된 회수(운영 확인) |
| 5 | 문서작성 — HWPX 생성 | kordoc 3.11 동작 |
| 6 | 광고심의 — OCR | Python 경로 정상 |
| 7 | `/admin` — 암호키 진입 | 설정·RAG 캐시 버튼 |
| 8 | 임베딩 API | `:8001/v1` 또는 Ollama 응답 |

---

## 9. 자주 나는 문제

| 증상 | 원인 | 조치 |
|------|------|------|
| `npm run build` 실패 · kordoc 오류 | `node_modules` 미갱신 | Linux에서 `npm ci` 후 반입 |
| 지식검색 의미검색 안 됨 | 임베딩 URL·모델·차원 불일치 | §6-1, `EMBEDDING_DIMENSIONS=1024` |
| 관리자 「허용되지 않은 IP」 | `ADMIN_ALLOWED_IPS` 또는 관리자 설정 | IP 추가 또는 제한 해제 |
| 관리자 암호 맞는데 다시 로그인 | `http://서버명` + production Secure 쿠키 | HTTPS(Nginx TLS) 또는 서버 본机 `127.0.0.1`에서 관리 |
| RAG 반영 안 된 것 같음 | 인메모리 캐시 | 재시작 또는 관리자 **RAG 캐시 새로고침** |
| `mongorestore` 경로 오류 | 덤프 경로·DB명 | `dump-2026-07-04/axplayground` 존재 확인 |

---

## 10. 관련 문서·스크립트

| 문서/스크립트 | 용도 |
|---------------|------|
| [`RAG_GRAPHRAG.md`](RAG_GRAPHRAG.md) | 하이브리드 RAG 구조 |
| [`data/mongo-snapshot/README.md`](../data/mongo-snapshot/README.md) | 시드·덤프 설명 |
| `scripts/update-rag-db.sh` | RAG 3컬렉션 교체 |
| `scripts/export-rag-db.sh` | RAG 3컬렉션만 추출(다음 반입용) |

---

## 11. 작업 순서 요약 (한 페이지)

```
[준비] .env.local 백업 · Mongo/LLM/임베딩 도달 확인
   ↓
[반입] §1 변경 파일만 (경로 A: git pull / 경로 B: ax-update-src·node_modules tar)
   ↓
[deps] npm ci (A) 또는 node_modules tar 반입 (B)
   ↓
[DB]   bash scripts/update-rag-db.sh data/mongo-snapshot/dump-2026-07-04
   ↓
[env]  .env.local — 임베딩 3줄 확인 (§6)
   ↓
[build] npm run build
   ↓
[run]  systemctl/pm2 재시작 · RAG 캐시 새로고침(선택)
   ↓
[검증] §8 체크리스트
```
