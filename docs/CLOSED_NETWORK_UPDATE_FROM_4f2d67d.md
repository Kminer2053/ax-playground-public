# 시스템 담당자용 — 폐쇄망 업데이트 안내  
## `4f2d67decc` → 최신 `main` (기존 데이터 유실 금지 · DB 증분만)

| 항목 | 내용 |
|------|------|
| **대상** | 내부망이 아직 **`4f2d67decc`**(관리자「소스 반영·서버 재시작」버튼 시점)인 환경 |
| **실운영** | **Linux** 서버 (AIWAS 등). Windows는 SecureGate 중계·Gitea 동기화용 |
| **목적** | `4f2d67d` 이후 쌓인 **코드·의존성·시드(RAG/법령/업무100)** 를 반영하되, **기존 운영 DB·설정·사용통계·로컬 파일은 유지** |
| **전달** | 본 문서를 시스템 담당자에게 전달. 일반 절차 보완: [`CLOSED_NETWORK_LINUX_UPDATE.md`](CLOSED_NETWORK_LINUX_UPDATE.md) |

> GitHub ↔ Gitea 방법론: [`CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md`](CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md)  
> git bundle: [`CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md)  
> 시드 명세: [`../data/mongo-snapshot/README.md`](../data/mongo-snapshot/README.md)

---

## 담당자 요약 (1분)

1. **코드**는 git(번들→Gitea→운영 `git pull`)으로 맞춘다. 폴더 zip 통째 덮어쓰기 금지(`.env.local` 유실 위험).  
2. **의존성**은 Linux용 `node_modules`를 **다시** 깐다 (`three` 등 추가). Windows용 zip을 리눅스에 쓰지 말 것.  
3. **DB**는 전체 `mongorestore --drop dump-*` **금지**. **필요 컬렉션만** `nsInclude`로 증분 교체.  
4. 작업 **전** 운영 DB 전체 백업 + `.env.local` 백업.  
5. OCR venv·Mongo 데이터 디렉터리·업로드/로그는 삭제하지 않는다.

---

## 0. 절대 원칙 (유실 금지)

| # | 원칙 |
|---|------|
| 1 | **금지:** `mongorestore --drop data/mongo-snapshot/dump-*` **전체** 복원 → 설정·퀴즈·공지·시드 콘텐츠까지 덮어씀 |
| 2 | DB/` .env.local` **백업 후**에만 변경 |
| 3 | `--drop`은 **`nsInclude`로 명시한 컬렉션만** |
| 4 | 소스 = **git pull / bundle**. 앱 루트에 zip 풀어 `.env.local`·업로드를 지우지 말 것 |
| 5 | OCR venv, Mongo data dir, 사용자 업로드·로그 = **보존** |
| 6 | 실운영 = **Linux**. `node_modules-win.zip`은 운영에 사용 불가 |

### 해시

| 항목 | 값 |
|------|-----|
| **BASE (내부망 현재)** | `4f2d67decc1619d69c6cccb5bf0b4a8cd6f32605` |
| **TARGET** | 본 안내서가 포함된 시점의 GitHub `main` tip (= 반입 bundle의 `main` HEAD). 적용 후 내부망 `git rev-parse HEAD`와 동일해야 함 |

```bash
# 외부망(또는 반입 후 내부망)에서 TARGET 확인
git fetch origin
git rev-parse origin/main
git rev-parse --short origin/main
```

---

## 1. `4f2d67d` 이후 무엇이 바뀌었는가

### 1-1. 코드·의존성 (반드시 반영)

| 영역 | 내용 |
|------|------|
| 업무100 / 업무탐색 | 온톨로지·3D 업무탐색(`three.js`)·보드·지식검색 연동 |
| 지식검색 | 인용 게이트·지식그래프·**외부 법령** 검색 격리 등 |
| 관리자 | 지식자산 현황·근거 재검토·문서 상세·공지 팝업·사용통계 세분화 등 |
| 의존성 | **`three`**, **`@types/three`**, **`ajv`** 등 → **Linux `node_modules` 재조립 필수** |
| OCR | **변경 없음** (venv 재구성 불필요) |

### 1-2. DB — 증분 반영이 **필요한** 것만

운영에 쌓인 설정·통계는 그대로 두고, 시드에서 **아래만** 가져온다.

| 구분 | 컬렉션 | 이유 |
|------|--------|------|
| **필수** | `rag_regulation` | 사규 + **외부 법령·행정규칙** (미반영 시 법령 검색 불가) |
| **필수** | `rag_vectors` | 임베딩 — `rag_regulation`과 **항상 함께** |
| **필수** | `rag_graph_edges` | 지식그래프 — 위 둘과 **항상 함께** |
| **권장** (업무탐색) | `ontology_nodes`, `ontology_edges`, `work100_boards` | BASE에 없으면 기능 공백 |
| **권장** (자산현황) | `asset_status` | 없으면 공백 → 또는 `npm run assets:backfill` |

> 필수 RAG 3종은 **한 세트**. 하나만 올리면 인덱스가 깨진다.  
> 덤프 경로(소스 반영 후): `data/mongo-snapshot/dump-2026-08-08`

### 1-3. DB — **절대 덮어쓰지 말 것**

| 컬렉션 | 이유 |
|--------|------|
| `playgroundconfigs` | 관리자 LLM·기능 설정 |
| `guardconfigs` | 가드레일 |
| `featureusages` | **사용통계** (시드에 없음, 런타임 누적) |
| `searchfeedbacks` / `knowledgequerylogs` / `auditlogs` | 피드백·질의·감사 로그 |
| `quizpools` / `quizlogs` / `quizrankings` / `pointlogs` | 퀴즈·포인트 |
| `notices`, `prompts`, `ad*`, `vocitems`, `libraryposts`, … | 현장 작성·수정분 |

### 1-4. 파일 — 보존

| 경로 | 조치 |
|------|------|
| `.env.local` | **백업 후 유지**. git에 없음 |
| MongoDB data directory | 삭제 금지 |
| OCR Python venv | 재설치 불필요 — 삭제 금지 |
| 업로드·첨부·앱 로그 | 유지 |
| `public/sagyu.json` | RAG 반영 후 `npm run sagyu:build`로 재생성 |

---

## 2. 역할 분담

```
[외부망 PC]  bundle + Linux node_modules.tar 반출
     ↓ SecureGate / USB
[내부망 중계 PC·Windows]  bundle → Gitea push
     ↓ git pull
[실운영 Linux]  의존성 → DB 증분 → build → 재시작   ← 본 문서의 핵심
```

---

## 3. 작업 순서 (실운영 Linux 기준)

```
① 백업 (mongodump 전체 + .env.local)
② 소스 (Gitea pull — 해시를 TARGET에 맞춤)
③ Linux node_modules 교체 (또는 오프라인 npm ci)
④ DB 증분: 필수 RAG 3 → (필요 시) 온톨로지/보드/asset_status
⑤ sagyu:build → npm run build → 서비스 재시작
⑥ 검증 (해시·건수·사용통계 유지·기능)
```

---

## 4. ① 백업 (필수 · Linux 운영)

`$APP_ROOT` = 앱 설치 경로 (예: `/opt/ax-playground`). URI·도구 경로는 현장 기준.

```bash
cd "$APP_ROOT"
stamp=$(date +%Y%m%d-%H%M%S)
out="/var/backups/axp-full-$stamp"   # 디스크 여유 있는 경로
mkdir -p "$out"

# MongoDB Database Tools (mongodump) — PATH 또는 절대경로
mongodump --uri="${MONGODB_URI:-mongodb://127.0.0.1:27017}" \
  --db="${MONGODB_DB:-axplayground}" --out="$out"

cp -a .env.local "$out/env.local.bak" 2>/dev/null || true
echo "backup -> $out"
```

롤백(비상, 백업 시점 **전체** 복구):

```bash
mongorestore --uri="${MONGODB_URI:-mongodb://127.0.0.1:27017}" --drop \
  "$out/axplayground"
```

> 일상 업데이트에는 전체 restore를 쓰지 않는다. 위는 **사고 복구용**이다.

---

## 5. ② 소스 반영

### 5-1. 외부망 — 증분 git bundle

```powershell
cd C:\ax-playground
git checkout main
git pull origin main
git rev-parse HEAD
# ↑ TARGET 메모

powershell -ExecutionPolicy Bypass -File infra\offline\export-git-bundle-incremental.ps1 -Base 4f2d67d
git bundle verify infra\offline\ax-playground-update.bundle
```

내부 clone에 BASE가 없으면 증분 실패 → **전체 bundle** 등 대체. 그 경우에도 **DB 전체 restore 금지**, `.env.local` 별도 보존.

### 5-2. 내부망 중계 → Gitea

SecureGate 수신 후 (Windows 중계 예):

```bat
infra\offline\apply-git-bundle-incremental.bat
```

비-fast-forward 시 먼저 `git branch backup-before-update` 후 `/HARD`.

### 5-3. 실운영 Linux

```bash
cd "$APP_ROOT"
cp -a .env.local ".env.local.bak.$(date +%Y%m%d)"   # 한 번 더

git fetch origin
git checkout main
git pull origin main

git rev-parse HEAD
# Gitea / 외부망 TARGET과 동일해야 함
```

---

## 6. ③ 의존성 (Linux 전용)

**Windows에서 만든 `node_modules` / `node_modules-win.zip`은 운영 Linux에 쓰지 않는다.**

| 환경 | 방법 |
|------|------|
| 오프라인 레지스트리 있음 | `npm ci` |
| 폐쇄망 | 조립 PC(Ubuntu amd64)에서 `npm ci` → `tar czf node_modules-linux.tgz node_modules` 반입 |

```bash
cd "$APP_ROOT"
# 반입 tar가 있으면:
#   rm -rf node_modules
#   tar xzf /path/to/ax-update-node_modules-YYYYMMDD.tgz -C "$APP_ROOT"

npm ci   # 또는 tar 복원만
npm ls three kordoc --depth=0
# three@0.185.x , kordoc@3.11.x , invalid 없음
```

`.env.local`은 건드리지 않는다. OCR venv는 그대로 둔다.

---

## 7. ④ DB 증분 반영 (Linux)

덤프: `$APP_ROOT/data/mongo-snapshot/dump-2026-08-08`

### 7-1. 필수 — 사규/RAG 3컬렉션만

`scripts/update-rag-db.sh`는 **RAG 3종만** 백업 후 `--drop` 복원한다.  
설정·사용통계·온톨로지·퀴즈 등은 **변경하지 않는다.**

```bash
cd "$APP_ROOT"
export MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017}"
export MONGODB_DB="${MONGODB_DB:-axplayground}"
# 필요 시: export MONGO_TOOLS=/usr/bin   # 또는 Database Tools bin

bash scripts/update-rag-db.sh data/mongo-snapshot/dump-2026-08-08
```

수동 (동일 범위):

```bash
mongorestore --uri="$MONGODB_URI" --drop \
  --nsInclude=axplayground.rag_regulation \
  --nsInclude=axplayground.rag_vectors \
  --nsInclude=axplayground.rag_graph_edges \
  data/mongo-snapshot/dump-2026-08-08
```

**기대 건수**

| 컬렉션 | 건수 |
|--------|------|
| `rag_regulation` | **212** (법령·행정규칙 **109** 포함) |
| `rag_vectors` | **4347** |
| `rag_graph_edges` | **2934** |

### 7-2. 권장 — 업무탐색용 (컬렉션이 없거나 0건일 때만)

이미 현장이 수정한 온톨로지가 있으면 **건너뛴다.**  
`4f2d67d` 기준 비어 있으면 시드에서 **해당 컬렉션만**:

```bash
mongorestore --uri="$MONGODB_URI" --drop \
  --nsInclude=axplayground.ontology_nodes \
  --nsInclude=axplayground.ontology_edges \
  --nsInclude=axplayground.work100_boards \
  --nsInclude=axplayground.asset_status \
  data/mongo-snapshot/dump-2026-08-08
```

| 컬렉션 | 기대 |
|--------|------|
| `ontology_nodes` | **231** |
| `ontology_edges` | **1150** |
| `work100_boards` | **169** |
| `asset_status` | **212** |

`asset_status`만 비었을 때 대안:

```bash
MONGODB_URI="$MONGODB_URI" MONGODB_DB="$MONGODB_DB" npm run assets:backfill
```

### 7-3. 사용통계·피드백 — 유실되지 않음

시드에 없고, 위 `nsInclude`에도 없다.

| 컬렉션 | 용도 |
|--------|------|
| `featureusages` | 관리자 **사용통계** |
| `searchfeedbacks` | 👍👎 |
| `knowledgequerylogs` | 지식검색 텔레메트리 |
| `auditlogs` | 가드레일 감사 |

복원 **전후** `featureusages` 건수를 기록해 검증한다 (`mongosh` 또는 node 드라이버).

### 7-4. 사규 목록 JSON

```bash
MONGODB_URI="$MONGODB_URI" MONGODB_DB="$MONGODB_DB" npm run sagyu:build
```

---

## 8. ⑤ 빌드 · 재시작 (Linux)

```bash
cd "$APP_ROOT"
test -f .env.local || { echo ".env.local missing"; exit 1; }

rm -rf .next
npm run build

# 현장 기준 하나:
#   sudo systemctl restart ax-playground
#   pm2 restart ax-portal
```

관리자 「소스 반영·서버 재시작」은 **Git · node_modules · DB · build가 끝난 뒤**에만.  
무중단으로 RAG만 반영한 경우: 관리자 → 설정 → **RAG 캐시 새로고침**.

---

## 9. ⑥ 완료 체크리스트 (담당자)

- [ ] §4 백업 경로·시각 기록
- [ ] `git rev-parse HEAD` = Gitea `main` = 외부망 TARGET
- [ ] `.env.local` 유지 (LLM URI 등)
- [ ] `npm ls three` → 0.185.x (`invalid` 없음) — **Linux** node_modules
- [ ] `rag_regulation` 212 · 법령 포함
- [ ] `featureusages` 등 **건수 ≥ 복원 전**
- [ ] 관리자 설정(LLM 등)이 시드 기본값으로 바뀌지 않음
- [ ] (업무탐색 사용 시) 온톨로지/보드 또는 화면 정상
- [ ] `/panel/knowledge` · 지식그래프 · `build` 성공 · 서비스 기동

---

## 10. 자주 막히는 곳

| 증상 | 조치 |
|------|------|
| bundle verify 실패 | SecureGate 손상 — 재반입 |
| 증분 bundle prerequisite 없음 | 내부 clone에 `4f2d67d` 없음 → 전체 bundle. **DB 전체 restore 금지** |
| Linux에서 native 모듈 오류 | Windows `node_modules`를 씀 → Linux용으로 재조립 |
| 업무탐색/3D 없음 | `three` 미설치 또는 옛 `.next` — `npm ci` + `build`; 온톨로지 비었으면 §7-2 |
| 법령 0건 | RAG 3종 미복원 — §7-1 |
| 설정(LLM) 초기화 | 전체 dump `--drop` 사용 → §4 백업에서 `playgroundconfigs` 등만 복구 |
| 사용통계 0 | URI/DB명 오인 확인. RAG 증분만으로는 통계가 지워지지 않음 |

---

## 11. Windows 중계만 참고 (운영 아님)

| 용도 | 산출물 |
|------|--------|
| SecureGate 수신·Gitea push | `apply-git-bundle-incremental.bat` |
| Windows **테스트** PC | `node_modules-win.zip` + `scripts/update-rag-db.ps1` |

실운영 Linux 절차는 **§4~§8**을 따른다. Windows 상세: [`CLOSED_NETWORK_WINDOWS_UPDATE.md`](CLOSED_NETWORK_WINDOWS_UPDATE.md)

---

## 12. 관련 문서 · 스크립트

| 문서/스크립트 | 용도 |
|---------------|------|
| [`CLOSED_NETWORK_LINUX_UPDATE.md`](CLOSED_NETWORK_LINUX_UPDATE.md) | Linux 일반 업데이트 |
| [`CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md) | bundle export/apply |
| [`CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md`](CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md) | GitHub→Gitea 담당자 방법론 |
| `scripts/update-rag-db.sh` | **RAG 3컬렉션만** 안전 교체 (Linux) |
| `scripts/update-rag-db.ps1` | 동일 (Windows 테스트) |
| [`../data/mongo-snapshot/README.md`](../data/mongo-snapshot/README.md) | 시드 19컬렉션 명세 |
