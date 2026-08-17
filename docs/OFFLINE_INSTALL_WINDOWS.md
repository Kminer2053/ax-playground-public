# 폐쇄망 설치 — 네이티브 Windows (WSL 없이)

이 문서는 **WSL 없이 Windows에서 직접** 구동하는 경우의 가이드다. (Windows라도 **WSL2(Ubuntu 24.04)** 를 쓴다면 리눅스와 동일하니 [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md)를 따른다 — 그쪽이 더 단순하다.)

앱·DB·OCR 모두 **127.0.0.1** 에서 동작. 외부 API 미사용. LLM(OpenAI 호환)은 **폐쇄망에 이미 탑재** 전제 — 연결만 한다.

```
[인터넷 Windows(amd64)]                       [폐쇄망 Windows]
  fetch-offline-bundle.ps1  ──(bundle-win\ 반입)──►  install-offline.ps1
   ├─ node-vXX-win-x64.zip                            ├─ Node 압축해제
   ├─ mongodb-windows-*.zip + tools                   ├─ MongoDB 기동(빈 DB)
   ├─ python-3.12.x-amd64.exe                         ├─ (Python 설치) OCR venv
   ├─ ocr\wheelhouse(win_amd64) + models_cache        └─ (LLM은 기존 폐쇄망 탑재 → 연결만)
   └─ node_modules-win.zip ← Windows에서 npm ci 로 별도 생성
```

리포에 **이미 포함**(반입 불필요): 앱 소스, `public\fonts`, `public\rhwp_bg.wasm`, `tools\hwpx`(stdlib). **초기 데이터(사규·법령)는 동봉하지 않으며** 설치 후 관리자 화면에서 적재한다(루트 `README.md` "초기 데이터 온보딩").
**별도 조립·반입**(플랫폼 의존): `infra\offline\bundle-win\`.

---

## 0. 준비물
- 운영 PC: **Windows 10/11 x64**, PowerShell 5.1+(기본 포함).
- 내부 LLM: 이미 폐쇄망 탑재 — 본 설치는 연결만.
- 조립용: **인터넷 되는 Windows(amd64)** + Node + Python 3.12. (또는 다른 머신에서 받아둔 `bundle-win\` 반입)
- 반입 매체(USB).

## 1. 번들 조립 — [인터넷 Windows]
```powershell
# 리포 클론 후
powershell -ExecutionPolicy Bypass -File infra\offline\fetch-offline-bundle.ps1
# → infra\offline\bundle-win\ 에 Node·MongoDB·Tools·Python·OCR(휠+모델) 생성
```
**node_modules 는 따로 만든다**(네이티브 바이너리라 Windows에서 `npm ci` 필요):
```powershell
npm ci
Compress-Archive -Path node_modules -DestinationPath infra\offline\bundle-win\node_modules-win.zip -Force
```
> `npm ci` 가 사내 프록시로 막히면 사내 npm 미러(`npm config set registry ...`)를 쓰거나, 닿는 다른 Windows에서 만들어 가져온다.

## 2. 반입
`bundle-win\`(+ `node_modules-win.zip`) 과 **소스 전체**를 USB로 폐쇄망 PC에 복사. 예: `C:\ax-playground\`.
> 맥/리눅스의 `node_modules\`·`.next\` 는 가져오지 말 것(OS·아키텍처가 다름). node_modules 는 `node_modules-win.zip` 으로만 반입한다.

## 3. 설치 — [폐쇄망 Windows]
```powershell
# 리포 루트에서 (관리자 PowerShell 권장)
powershell -ExecutionPolicy Bypass -File infra\offline\install-offline.ps1
```
스크립트가 수행: Node 해제 → `node_modules` 해제 → MongoDB 기동(127.0.0.1) → OCR venv 구성(Python 있을 때). 설치 베이스는 기본 `C:\axp`(`$env:AXP_PREFIX` 로 변경 가능).

- **OCR 까지 쓰려면 Python 3.12 필요**. 미설치면 5단계를 건너뛰고 안내가 뜬다. 설치:
  ```powershell
  Start-Process .\infra\offline\bundle-win\python-3.12.10-amd64.exe -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_launcher=1' -Wait
  ```
  설치 후 스크립트를 다시 실행하면 OCR venv 가 만들어진다(또는 OCR 불필요 시 `.env.local` 에 `OCR_PROVIDER=none`). Windows Python 은 venv 에 pip 가 기본 포함이라 우분투의 `python3.12-venv` 같은 별도 패키지가 필요 없다.

## 4. 환경 변수 — `.env.local`
```powershell
copy .env.example .env.local
notepad .env.local
```
| 변수 | 예시 | 설명 |
|------|------|------|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | Mongo 연결 |
| `MONGODB_DB` | `axplayground` | DB명(기본 axplayground) |
| `SESSION_SECRET` | 32자+ 랜덤 | iron-session 암호 |
| `ADMIN_ACCESS_KEY` | 8자+ | `/admin` 키 |
| `OPENAI_COMPATIBLE_BASE_URL` | `http://<내부LLM>/v1` | 기존 폐쇄망 LLM |
| `OPENAI_COMPATIBLE_MODEL` | `<모델명>` | 채팅·비전 모델 |
| `OCR_PROVIDER` | `python` / `none` | OCR·문서작성 쓰면 `python` |
| `PYTHON_BIN` | `C:\axp\ocr\venv\Scripts\python.exe` | **문서 HWPX + 광고 OCR 공통** (setup-ocr-windows.ps1) |
| `LLM_TIMEOUT_MS` | `120000` | Ollama hung 방지 (선택, 기본 120초) |

> **문서작성·광고심의 Python:** `install-offline.ps1` 5단계가 Python 미설치로 건너뛰어진 경우가 많다.  
> [`CLOSED_NETWORK_WINDOWS_UPDATE.md`](CLOSED_NETWORK_WINDOWS_UPDATE.md) → `setup-ocr-windows.ps1` + `.env.local` `PYTHON_BIN`.

## 5. 기동
```powershell
# install 스크립트를 돌린 그 PowerShell 세션은 PATH 에 node 가 잡혀 있음
npm run dev      # http://127.0.0.1:3000  (운영형은 npm run build ; npm run start)
```
새 창에서 쓰려면 PATH 추가: `$env:Path = "C:\axp\node\node-v22.12.0-win-x64;$env:Path"`.

## 6. 검증
```powershell
curl http://localhost:3000/api/db/status     # database:"axplayground", regulationCount:74
```
- 메인 이미지맵 로드 → `/admin` 키 진입 → LLM 패널 응답(내부 LLM 도달 시).

## 7. 상시 운영(선택)
- **MongoDB 자동기동**: NSSM 등으로 `mongod.exe --dbpath C:\axp\data --bind_ip 127.0.0.1 --logpath C:\axp\log\mongod.log` 를 Windows 서비스로 등록(재부팅 후 자동 기동).
- **앱 자동기동**: `npm run build` 후 `npm run start` 를 서비스(NSSM/pm2-windows)로 등록.

## 8. 트러블슈팅
| 증상 | 점검 |
|------|------|
| `install-offline.ps1` 실행 차단 | `-ExecutionPolicy Bypass` 로 실행, 또는 `Unblock-File` |
| `node_modules-win.zip 없음` | Windows에서 `npm ci` → Compress-Archive 로 생성(§1) |
| OCR 5단계 건너뜀 | Python 3.12 설치(§3) 후 `setup-ocr-windows.ps1` 또는 `install-offline.ps1 -OcrOnly` |
| 문서작성 Python 없음 | `.env.local` `PYTHON_BIN=C:\axp\ocr\venv\Scripts\python.exe` |
| 광고심의 OCR 안 됨 | 위와 동일 + `OCR_PROVIDER=python` + `verify-windows.ps1` |
| 소스만 업데이트 | [`CLOSED_NETWORK_WINDOWS_UPDATE.md`](CLOSED_NETWORK_WINDOWS_UPDATE.md) |
| AI 응답 없음 | `OPENAI_COMPATIBLE_BASE_URL` 도달·모델명 일치 |
| 재부팅 후 DB 끊김 | `mongod.exe` 재기동(§5) 또는 서비스 등록(§7) |

> 리눅스(Ubuntu·WSL2) 대상은 [`OFFLINE_INSTALL.md`](OFFLINE_INSTALL.md) 참고. 두 트랙은 **번들·스크립트만 다르고**(리눅스=`bundle/`+`*.sh`, Windows=`bundle-win/`+`*.ps1`) 앱·시드·환경변수는 동일하다.
