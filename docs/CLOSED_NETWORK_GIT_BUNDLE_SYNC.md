# 폐쇄망 Git 동기화 — Git bundle (전체·증분)

**대상:** GitHub(`origin`)와 내부망 **Gitea**·로컬 작업 폴더를 커밋 단위로 맞추는 운영자  
**전제:** 외부망 ↔ 내부망 직접 `git push`/`git pull` 불가 → **USB로 `*.bundle` 반입**

> **시스템 담당자용(방법론·역할·검증):** [`CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md`](CLOSED_NETWORK_GITHUB_GITEA_SYNC_ADMIN.md)  
> **내부망 `4f2d67d` → 최신 일괄 업데이트:** [`CLOSED_NETWORK_UPDATE_FROM_4f2d67d.md`](CLOSED_NETWORK_UPDATE_FROM_4f2d67d.md)  
> 소스만 급히 덮어쓰기(파일 단위 증분 반입): [`CLOSED_NETWORK_LINUX_UPDATE.md`](CLOSED_NETWORK_LINUX_UPDATE.md) §1  
> Windows 배포·OCR: [`CLOSED_NETWORK_WINDOWS_UPDATE.md`](CLOSED_NETWORK_WINDOWS_UPDATE.md)  
> 최초 폐쇄망 설치: [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md)

---

## 0. 개념

| 방식 | 용도 | 크기 |
|------|------|------|
| **전체 bundle** | Gitea·로컬이 zip/수동 커밋으로 **히스토리가 꼬였을 때** | ~100MB+ |
| **증분 bundle** | 이미 커밋이 맞춰진 뒤 **새 커밋만** 반영 | 보통 KB~수 MB |
| **파일만 반입** | Git 동기화 없이 **배포만** 빠르게 | 변경 파일만 |

**zip 다운로드는 비추천** — `.git` 히스토리가 없어 Gitea와 커밋 해시가 절대 같아지지 않습니다.  
**git bundle**은 오프라인에서도 `git fetch`와 동일하게 커밋·히스토리를 옮깁니다.

---

## 1. 용어·경로 (예시)

| 구분 | 예시 |
|------|------|
| 외부망 작업 폴더 | `C:\ax-playground` |
| 내부망 Gitea clone | `C:\projects\ax-playground` |
| Gitea URL | `http://<내부-gitea-호스트>:<포트>/<조직>/ax-playground.git` |
| 망간자료전송 반입 경로 | `C:\<망간전송솔루션>\Download\` |
| bundle 저장(외부망) | `infra\offline\ax-playground-main.bundle` |

내부망 clone의 `origin`이 **Gitea**를 가리키면, `git push origin` = Gitea 반영입니다.

---

## 2. 최초 1회 — 전체 bundle (히스토리 맞추기)

zip으로만 올려 두었다면 **한 번** 전체 bundle + **force push**로 GitHub `main`과 커밋 해시를 일치시킵니다.

### 2-1. 외부망 (PowerShell)

```powershell
cd C:\ax-playground
git fetch origin
git checkout main
git pull origin main
git log -1 --oneline

git bundle create infra\offline\ax-playground-main.bundle origin/main
git bundle verify infra\offline\ax-playground-main.bundle
```

`verify`에 `is okay` · `refs/remotes/origin/main` · 커밋 해시가 보이면 USB 반입.

### 2-2. 내부망 (PowerShell) — 기존 Gitea clone 폴더에서

```powershell
cd C:\AI-Coding\projects\ax-playground
git remote -v
# origin → Gitea 인지 확인

git bundle verify C:\HANSSAK\SecureGate\Download\ax-playground-main.bundle
git bundle list-heads C:\HANSSAK\SecureGate\Download\ax-playground-main.bundle
# 예: de38d21... refs/remotes/origin/main

git fetch C:\HANSSAK\SecureGate\Download\ax-playground-main.bundle refs/remotes/origin/main:refs/heads/github-main
git checkout main
git reset --hard github-main
git log -1 --oneline

git push origin main --force
```

### 2-3. 검증

```powershell
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

두 해시가 **동일**하면 GitHub( bundle 기준 ) = Gitea = 로컬 `main` 일치.

> `git clone *.bundle`만 하면 `empty repository` 경고가 날 수 있습니다.  
> bundle ref가 `refs/remotes/origin/main` 형태이기 때문 — **§2-2처럼 기존 clone에서 `fetch`** 하는 방식이 안전합니다.

---

## 3. 일상 업데이트 — 증분 bundle (권장)

전체 bundle·force push는 **다시 할 필요 없습니다.**  
내부망에 이미 반영된 **마지막 커밋 해시**부터 GitHub `main` 끝까지만 담습니다.

### 3-1. 내부망 “기준 커밋” 확인

```powershell
cd C:\AI-Coding\projects\ax-playground
git fetch origin
git rev-parse HEAD
# 예: de38d21ede0ef7e4905211bf41769aa6fd8c03fa  ← 이 값을 메모(외부망 bundle 만들 때 사용)
```

또는 Gitea 웹 UI에서 `main` 최신 커밋 해시를 확인합니다.

### 3-2. 외부망 — 증분 bundle 생성

```powershell
cd C:\ax-playground
git pull origin main
git log -1 --oneline

# <BASE> = 내부망에 이미 있는 커밋 해시 (짧은 7자도 가능)
git bundle create infra\offline\ax-playground-update.bundle de38d21..HEAD

git bundle verify infra\offline\ax-playground-update.bundle
git bundle list-heads infra\offline\ax-playground-update.bundle
```

- 커밋이 0개면 bundle 생성이 실패합니다 → 내부망이 이미 최신입니다.
- 커밋이 여러 개면 한 bundle에 **연속 구간 전체**가 들어갑니다.

**파일명 규칙 예:** `ax-playground-update-20260707.bundle` (날짜 붙이면 이력 관리 편함)

### 3-3. 내부망 — 반영 (force 보통 불필요)

```powershell
cd C:\AI-Coding\projects\ax-playground

git bundle verify C:\HANSSAK\SecureGate\Download\ax-playground-update.bundle

git fetch C:\HANSSAK\SecureGate\Download\ax-playground-update.bundle refs/remotes/origin/main:refs/heads/github-main
git checkout main
git merge github-main
# 로컬 수정 없고 무조건 GitHub와 같게: git reset --hard github-main

git log -1 --oneline
git push origin main
```

히스토리가 이미 맞춰져 있으면 **`git push origin main`만으로** Gitea에 반영됩니다 (`--force` 없음).

### 3-4. 배포 서버(앱 구동 경로)까지 맞추기

Gitea push만으로 앱이 자동 재시작되지는 않습니다. 서비스가 clone 해 둔 경로에서:

```powershell
cd C:\projects\ax-playground   # 또는 PM2/서비스가 쓰는 동일 경로
git pull origin main
npm run build
# npm run start 또는 PM2 재시작
```

Linux 서버면 동일하게 `git pull` → `npm run build` → `pm2 restart`.

---

## 4. 언제 무엇을 쓰나

| 상황 | 방법 |
|------|------|
| Gitea·GitHub 커밋 해시 **처음** 맞추기 | §2 전체 bundle + `--force` |
| GitHub에 **새 커밋** 몇 개 반영 | §3 증분 bundle |
| **파일 1~수십 개**만 급히 배포 | 변경 파일 USB 반입 — [`CLOSED_NETWORK_LINUX_UPDATE.md`](CLOSED_NETWORK_LINUX_UPDATE.md) §1 |
| 내부에서만 커밋했다가 GitHub와 **충돌** | §5 트러블슈팅 — 백업 브랜치 후 재정렬 |
| `package.json` / lock 변경 | bundle 후 **`npm ci`** (Linux는 Linux용 `node_modules`) |

---

## 5. 트러블슈팅

| 증상 | 조치 |
|------|------|
| `bundle is okay` 실패 | SecureGate 반입 중 파일 손상 — 외부망에서 `verify` 후 재반입 |
| `empty repository` (clone 시) | §2-2 방식으로 **fetch** 사용; ref 이름 `refs/remotes/origin/main` 확인 |
| `non-fast-forward` push 거절 | 내부에만 있는 커밋이 있음 — `git branch backup-날짜` 후 `reset --hard github-main` → `push --force` (§2와 동일) |
| `HEAD`와 `ls-remote origin` 불일치 | `git push origin main` 누락 또는 다른 브랜치 push |
| bundle에 커밋 없음 (`de38d21..HEAD` 실패) | 내부망 `BASE` 해시가 이미 최신 — bundle 불필요 |
| `.env.local` / `node_modules` | Git 대상 아님 — 서버에 그대로 유지 |

### 내부 전용 커밋 백업 후 GitHub 기준으로 덮기

```powershell
git branch backup-before-sync-$(Get-Date -Format yyyyMMdd)
git fetch <bundle경로> refs/remotes/origin/main:refs/heads/github-main
git checkout main
git reset --hard github-main
git push origin main --force
```

---

## 6. 보안·운영 메모

- Gitea URL에 **비밀번호를 넣지 말 것** — `git credential` 또는 토큰 사용 권장.
- bundle·USB에는 **`.env.local`·시크릿**을 넣지 않습니다 (리포에 없어야 함).
- **force push**는 Gitea `main`의 내부-only 커밋을 **삭제**합니다. 백업 브랜치 후 실행.
- **localhost(서비스 구동 머신)** 는 관리자 IP 제한과 별개로 복구 경로로 항상 접근 가능 — [`src/lib/adminIp.ts`](../src/lib/adminIp.ts).

---

## 7. 스크립트 (자동화)

| 스크립트 | 실행 위치 | 용도 |
|----------|-----------|------|
| `infra/offline/export-git-bundle-incremental.ps1` | **외부망** | `git-bundle-base.txt` 기준 → `ax-playground-update.bundle` 생성 |
| `infra/offline/apply-git-bundle-incremental.bat` | **내부망** | SecureGate 반입 bundle → Gitea `push` + `git-bundle-base.txt` 갱신 |

**기준 커밋 파일:** `infra/offline/git-bundle-base.txt` — 내부망 apply 성공 시 자동 갱신. 다음 외부망 bundle은 이 해시부터 `HEAD`까지.

### 외부망 (PowerShell)

```powershell
cd C:\ax-playground
git pull origin main
powershell -ExecutionPolicy Bypass -File infra\offline\export-git-bundle-incremental.ps1
# USB: infra\offline\ax-playground-update.bundle -> SecureGate Download
```

### 내부망 (배치 — 더블클릭 가능)

기본 경로:

- 리포: `C:\AI-Coding\projects\ax-playground`
- bundle: `C:\HANSSAK\SecureGate\Download\ax-playground-update.bundle`

```bat
infra\offline\apply-git-bundle-incremental.bat
```

히스토리 꼬임 시:

```bat
infra\offline\apply-git-bundle-incremental.bat /HARD
```

적용 후: `npm run build` → 앱 재시작.

---

## 8. 빠른 참조 (수동 · 증분 한 사이클)

**외부망**

```powershell
cd C:\ax-playground
git pull origin main
git bundle create infra\offline\ax-playground-update.bundle <내부BASE해시>..HEAD
```

**내부망**

```powershell
cd C:\AI-Coding\projects\ax-playground
git fetch C:\HANSSAK\SecureGate\Download\ax-playground-update.bundle refs/remotes/origin/main:refs/heads/github-main
git checkout main
git merge github-main
git push origin main
npm run build
```

**검증:** `git rev-parse HEAD` = `git ls-remote origin refs/heads/main`
