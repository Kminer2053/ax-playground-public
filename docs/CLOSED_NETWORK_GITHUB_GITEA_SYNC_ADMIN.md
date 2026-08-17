# 폐쇄망 소스 동기화 — 시스템 담당자용 안내

**대상:** 내부망 시스템·인프라 담당자 (소스 반입 정책·검증·문의 대응)  
**목적:** 외부망 **GitHub**와 내부망 **Gitea**를 **동일 커밋 해시**로 유지하는 방식의 배경·역할·검증 기준을 설명한다.  
**명령·스크립트 상세:** [`CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md)

---

## 1. 한 줄 요약

외부망에서 인터넷으로 `git pull`한 뒤, **git bundle** 파일을 SecureGate(USB)로 내부망 **업무용 PC**에 반입하고, 그 PC가 **내부 Gitea**에 `git push`한다.  
그 결과 GitHub `main` · 업무용 PC · Gitea `main`의 커밋 해시가 **바이트 단위로 동일**하다.

```
[외부망]                         [반입]                    [내부망]
GitHub (origin/main)
    │
    ▼
개발·조립 PC  git pull
    │
    ▼
*.bundle 생성  ──────────── SecureGate / USB ──────────►  업무용 PC (Gitea clone)
                                                              │
                                                              ├─ fetch / merge (또는 reset)
                                                              ▼
                                                         내부 Gitea (origin)
                                                              │
                                                              ▼
                                                         운영 서버 git pull (배포)
```

> zip·폴더 복사로 소스를 “맞춘 것처럼” 보이게 하는 방식과는 다르다.  
> **Git 객체(커밋·트리·파일 blob) 자체가** GitHub와 같아야 한다.

---

## 2. 왜 이 방식이 필요한가

| 제약 | 의미 |
|------|------|
| 외부망 ↔ 내부망 **직접 `git push` / `git pull` 불가** | GitHub를 origin으로 두고 내부 Gitea가 자동 미러할 수 없다. |
| 폐쇄망에서 **인터넷 npm/git remote 불가** | 소스는 물리 반입(USB·SecureGate)이 필수다. |
| 배포·감사·장애 대응 | “어느 커밋이 내부망에 있는지”를 **해시로** 확인할 수 있어야 한다. |

### 2-1. zip / 폴더 복사가 부족한 이유

| 방식 | 결과 |
|------|------|
| GitHub zip / `git archive` / 파일만 USB 복사 | `.git` 히스토리 없음 → 내부에서 새 커밋을 만들면 **해시가 영원히 GitHub와 불일치** |
| 내부망에서만 커밋·수정 누적 | Gitea `main`이 GitHub와 **분기(diverge)** → 이후 반입이 충돌 |
| **git bundle** | 오프라인 `git fetch`와 동일. **같은 커밋 객체·같은 해시**를 통째로 옮김 |

담당자가 기억할 원칙:

> **소스가 같아 보이는 것 ≠ Git이 같다.**  
> 내부망 기준 진실은 **Gitea `main`의 커밋 해시 = GitHub `main`의 커밋 해시**이다.

---

## 3. 구성 요소 (역할)

| 구간 | 담당 | 하는 일 | 하지 않는 일 |
|------|------|---------|----------------|
| **GitHub** (`origin`, 외부망) | 개발 | 정식 `main` 커밋·PR 머지 | 내부망 직접 push 없음 |
| **외부망 조립/개발 PC** | 개발·운영 지원 | `git pull` 후 **증분(또는 전체) bundle 생성** · USB 반출 | 내부 Gitea에 직접 접속 안 함 |
| **SecureGate / USB** | 보안·반입 절차 | `*.bundle` 파일만 전달 | `.env`·시크릿·`node_modules` 넣지 않음 |
| **내부망 업무용 PC** | 내부 작업자 | bundle **검증 → fetch → main 반영 → `git push` → Gitea** | 가능하면 내부-only 커밋으로 `main`을 분기하지 않음 |
| **내부 Gitea** | 인프라 | 내부망 **유일한 소스 원격 저장소** | 인터넷 GitHub와 직접 연동하지 않음 |
| **운영 서버**(앱) | 인프라·운영 | Gitea에서 `git pull` → `npm ci`(필요 시) → `build` → 재시작 | GitHub를 origin으로 두지 않음 |

예시 경로(현장 값으로 치환):

| 항목 | 예시 |
|------|------|
| 외부망 리포 | `C:\ax-playground` (GitHub remote) |
| 업무용 PC clone | `C:\AI-Coding\projects\ax-playground` (origin = **Gitea**) |
| Gitea URL | `http://<내부-gitea-호스트>:<포트>/<조직>/ax-playground.git` |
| SecureGate 반입 | `C:\HANSSAK\SecureGate\Download\` |
| bundle 파일명 | `ax-playground-update.bundle` (일상) / `ax-playground-main.bundle` (최초 정렬) |

---

## 4. 동기화의 두 단계

### 4-1. 최초 1회 — 히스토리 정렬 (전체 bundle)

이미 zip·수동 복사로 Gitea를 썼다면 **커밋 해시가 GitHub와 다를 수 있다.**  
이때만 **전체 bundle** + (필요 시) Gitea `main`에 **`--force` push**로 GitHub와 맞춘다.

- 목적: 이후부터는 **증분만**으로 운영 가능하게 만드는 기반 작업
- 주의: force push는 Gitea `main`의 **내부 전용 커밋을 덮어쓴다** → 반드시 백업 브랜치 후 수행

상세: [`CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md) §2

### 4-2. 일상 — 증분 bundle (권장)

내부망에 이미 있는 **마지막 커밋 해시(BASE)** 부터 GitHub `HEAD`까지의 **새 커밋만** bundle에 담는다.

| 단계 | 위치 | 요약 |
|------|------|------|
| 1 | 외부망 | `git pull` → `export-git-bundle-incremental.ps1` (또는 `BASE..HEAD` bundle 생성) |
| 2 | 반입 | `ax-playground-update.bundle` → SecureGate Download |
| 3 | 업무용 PC | `apply-git-bundle-incremental.bat` → Gitea `push` |
| 4 | (선택) 외부망으로 | 갱신된 `git-bundle-base.txt`를 다음 증분 BASE로 동기 |
| 5 | 운영 서버 | Gitea `git pull` → 빌드·재시작 |

히스토리가 이미 맞춰져 있으면 일상 반영에 **`--force`는 필요 없다.**

자동화 스크립트:

| 파일 | 실행 | 역할 |
|------|------|------|
| `infra/offline/export-git-bundle-incremental.ps1` | 외부망 | BASE→HEAD 증분 bundle 생성 |
| `infra/offline/apply-git-bundle-incremental.bat` | 업무용 PC | verify 적용 + Gitea push + BASE 파일 갱신 |
| `infra/offline/git-bundle-base.txt` | 양측 | “내부망에 이미 있는 커밋” 기록 |

상세: [`CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md) §3 · §7

---

## 5. 담당자가 확인할 “일치” 기준

작업 후 **세 곳의 해시가 같으면** 동기화 성공이다.

```text
GitHub main  ==  업무용 PC HEAD  ==  Gitea refs/heads/main
```

내부망(업무용 PC)에서:

```powershell
cd C:\AI-Coding\projects\ax-playground
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

두 출력이 **동일한 40자(또는 짧게 봐도 동일 커밋)** 이어야 한다.

외부망에서는 GitHub:

```powershell
git rev-parse origin/main
# 또는 GitHub 웹 UI main 최신 커밋
```

운영 서버도 같은 해시여야 배포가 “공식본”과 일치한다:

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

| 증상 | 의미 |
|------|------|
| PC HEAD ≠ Gitea | `git push origin main` 누락 |
| Gitea ≠ GitHub | 증분 미반입, 또는 내부-only 커밋으로 분기 |
| 소스는 같은데 해시만 다름 | zip/파일 복사로 올렸을 가능성 — **전체 bundle로 재정렬** 필요 |

---

## 6. Git 동기화와 배포의 구분

| 구분 | 내용 |
|------|------|
| **Git 동기화 (이 문서)** | 커밋 객체를 Gitea까지 옮김 → **해시 일치** |
| **앱 배포** | 운영 경로에서 `git pull` + `npm ci`(lock 변경 시) + `npm run build` + 프로세스 재시작 |
| **런타임 의존성** | `node_modules`는 Git이 아님. lock이 바뀌었는데 `npm ci`를 안 하면 **같은 커밋이라도 동작이 깨질 수 있음** (예: kordoc 버전) |
| **시크릿** | `.env.local`은 Git·bundle에 넣지 않음. 서버에만 유지 |
| **RAG DB·시드** | 소스 sync와 별도 절차 — Linux 업데이트 안내는 [`CLOSED_NETWORK_LINUX_UPDATE.md`](CLOSED_NETWORK_LINUX_UPDATE.md) |

Gitea에 push했다고 **운영 앱이 자동으로 갱신되지는 않는다.**  
업무용 PC(또는 배포 서버)에서 pull·build·재시작이 한 단계 더 필요하다.

---

## 7. 보안·운영 주의

1. **bundle에는 소스 Git 객체만** — 비밀번호, `.env`, 사내 DB 덤프 비공개본을 넣지 않는다.  
2. **Gitea URL에 비밀번호를 하드코딩하지 않는다** — credential helper / 토큰.  
3. **`git push --force`는 예외 처리** — 최초 정렬·히스토리 복구 시만. 사전 `backup-날짜` 브랜치 권장.  
4. **내부망 `main`에만 올리기** — 가능하면 수정은 외부 GitHub → bundle 경로로만 흘린다. 내부-only 커밋은 다음 동기화에서 충돌·force의 원인이 된다.  
5. **SecureGate 손상** — 반입 후 `git bundle verify` 실패 시 재반입. 압축 없이 `.bundle` 그대로 전달한다.

---

## 8. FAQ (담당자 문의용)

**Q. 파일 내용만 같으면 된 것 아닌가?**  
A. 배포·롤백·감사는 **커밋 해시**로 한다. zip으로 맞추면 해시가 달라져 “어느 버전이 내부인가”를 추적할 수 없다.

**Q. 업무용 PC를 건너뛰고 USB에서 서버에만 풀면?**  
A. 가능은 하나, **Gitea를 단일 소스로 두지 않으면** PC·서버·백업이 각각 다른 트리가 되기 쉽다. 현재 방법론은 **업무용 PC → Gitea push → 서버는 Gitea pull** 이다.

**Q. Everything up-to-date 가 나온다.**  
A. 이미 Gitea `main`이 bundle과 같은 커밋이다. 정상. 배포만 필요하면 서버에서 `git pull`·build를 하면 된다.

**Q. 비-fast-forward 로 push가 거절된다.**  
A. Gitea `main`에 GitHub에 없는 커밋이 있다. 백업 브랜치 후 `/HARD`(reset) 또는 전체 bundle 정렬. 상세는 운영 문서 §5.

**Q. 소스 sync 후 기능만 이상하다.**  
A. 커밋은 맞았어도 `npm ci` 미실시·옛 `.next`·옛 `node_modules`일 수 있다. lock/`package.json` 변경 여부를 확인한다.

---

## 9. 관련 문서

| 문서 | 용도 |
|------|------|
| [`CLOSED_NETWORK_GIT_BUNDLE_SYNC.md`](CLOSED_NETWORK_GIT_BUNDLE_SYNC.md) | **실무 명령·스크립트·트러블슈팅** (운영자) |
| [`CLOSED_NETWORK_UPDATE_FROM_4f2d67d.md`](CLOSED_NETWORK_UPDATE_FROM_4f2d67d.md) | 내부망 `4f2d67d`→최신 main · **Linux 실운영** · DB 증분·유실 금지 (담당자 전달용) |
| [`CLOSED_NETWORK_LINUX_UPDATE.md`](CLOSED_NETWORK_LINUX_UPDATE.md) | Linux 운영 서버 업데이트·RAG DB |
| [`CLOSED_NETWORK_WINDOWS_UPDATE.md`](CLOSED_NETWORK_WINDOWS_UPDATE.md) | Windows 폐쇄망 소스·의존성 업데이트 |
| [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md) / [`OFFLINE_INSTALL_WINDOWS.md`](OFFLINE_INSTALL_WINDOWS.md) | 최초 설치 |
| [`infra/offline/README.md`](../infra/offline/README.md) | 오프라인 번들(Node·Mongo·OCR) 조립 — **소스 Git sync와 별개** |

---

## 10. 담당자 체크리스트 (복붙용)

- [ ] GitHub `main`과 Gitea `main` 커밋 해시가 동일한가?
- [ ] 일상 반입이 **git bundle**인가? (zip이 아닌가?)
- [ ] 업무용 PC `origin`이 **내부 Gitea**인가?
- [ ] push 후 `git ls-remote origin refs/heads/main` = 로컬 `HEAD`인가?
- [ ] 운영 서버는 Gitea에서 pull 했는가? (build·재시작 포함)
- [ ] `package-lock.json` 변경 시 서버에서 `npm ci` 했는가?
- [ ] force push가 필요했다면 백업 브랜치를 남겼는가?
- [ ] bundle·USB에 `.env` / 시크릿이 없는가?
