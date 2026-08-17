<#
  AX Playground 폐쇄망 설치 — 네이티브 Windows (WSL 아님)
  ──────────────────────────────────────────────────────────────────────────
  전제:
   - infra\offline\bundle-win\ 가 반입돼 있어야 한다(이 스크립트가 그 안의 파일을 읽기만 함).
   - node_modules-win.zip 은 Windows에서 'npm ci' 후 압축해 bundle-win\ 에 넣어둘 것.
     (예: Windows에서  npm ci  →  Compress-Archive -Path node_modules -DestinationPath infra\offline\bundle-win\node_modules-win.zip)
   - LLM(OpenAI 호환)은 폐쇄망에 이미 탑재 전제 — 설치하지 않고 .env.local 로 연결만 한다.
  실행: PowerShell(관리자 권장)에서 리포 루트 기준으로
     powershell -ExecutionPolicy Bypass -File infra\offline\install-offline.ps1
  멱등하지 않음 — 한 번만 실행 권장(MongoDB 기동/추출 단계는 재실행 시 충돌 가능).
  자세한 맥락: docs\OFFLINE_INSTALL_WINDOWS.md
#>
param(
  [switch]$OcrOnly   # Python 설치 후 OCR venv(5단계)만 재실행
)
$ErrorActionPreference = "Stop"
$Root   = (Resolve-Path "$PSScriptRoot\..\..").Path
$Bundle = Join-Path $Root "infra\offline\bundle-win"
$Prefix = if ($env:AXP_PREFIX) { $env:AXP_PREFIX } else { "C:\axp" }

if (-not (Test-Path $Bundle)) { throw "$Bundle 없음 — bundle-win 을 반입하세요." }
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null

function First-Dir($glob) { (Get-ChildItem $glob -Directory -ErrorAction Stop | Select-Object -First 1).FullName }
function First-File($glob) { (Get-ChildItem $glob -File -ErrorAction Stop | Select-Object -First 1).FullName }

if ($OcrOnly) {
  Write-Host "==> OCR venv only (5/5)"
  & "$PSScriptRoot\setup-ocr-windows.ps1" -Prefix $Prefix
  exit $LASTEXITCODE
}

# ── 1/5 Node.js ───────────────────────────────────────────────
Write-Host "==> 1/5  Node.js"
Expand-Archive -Path (First-File "$Bundle\node-v*-win-x64.zip") -DestinationPath "$Prefix\node" -Force
$NodeDir = First-Dir "$Prefix\node\node-v*-win-x64"
$env:Path = "$NodeDir;$env:Path"
& "$NodeDir\node.exe" -v

# ── 2/5 node_modules ──────────────────────────────────────────
Write-Host "==> 2/5  node_modules"
$nmZip = Join-Path $Bundle "node_modules-win.zip"
if (Test-Path $nmZip) {
  if (Test-Path "$Root\node_modules") { Remove-Item "$Root\node_modules" -Recurse -Force }
  Expand-Archive -Path $nmZip -DestinationPath $Root -Force
} else {
  Write-Warning "node_modules-win.zip 없음. 인터넷이 되면 지금 npm ci 를 시도합니다(레지스트리 필요)."
  Push-Location $Root; & "$NodeDir\npm.cmd" ci; Pop-Location
}

# ── 3/5 MongoDB 설치 + 기동(127.0.0.1) ────────────────────────
Write-Host "==> 3/5  MongoDB"
Expand-Archive -Path (First-File "$Bundle\mongodb-windows-*.zip") -DestinationPath "$Prefix\mongodb" -Force
Expand-Archive -Path (First-File "$Bundle\mongodb-database-tools-windows-*.zip") -DestinationPath "$Prefix\mongotools" -Force
$MongoBin = Join-Path (First-Dir "$Prefix\mongodb\mongodb-*") "bin"
$ToolsBin = Join-Path (First-Dir "$Prefix\mongotools\mongodb-database-tools-*") "bin"
$env:Path = "$MongoBin;$ToolsBin;$env:Path"
New-Item -ItemType Directory -Force -Path "$Prefix\data","$Prefix\log" | Out-Null
if (Get-Process mongod -ErrorAction SilentlyContinue) {
  Write-Host "  mongod 이미 실행 중 — 기동 건너뜀"
} else {
  Start-Process -FilePath "$MongoBin\mongod.exe" `
    -ArgumentList "--dbpath `"$Prefix\data`" --bind_ip 127.0.0.1 --logpath `"$Prefix\log\mongod.log`"" `
    -WindowStyle Hidden
  Start-Sleep -Seconds 6
}

# ── 4/5 시드 덤프 복원 (axplayground) ─────────────────────────
Write-Host "==> 4/5  시드 복원"
$Dump = First-Dir "$Root\data\mongo-snapshot\dump-*"
if ($Dump) {
  & "$ToolsBin\mongorestore.exe" --uri="mongodb://127.0.0.1:27017" --drop "$Dump"
} else {
  Write-Host "  (건너뜀) data\mongo-snapshot\dump-* 없음 — 덤프는 리포에 미동봉. 빈 DB로 기동 후 README '초기 데이터 온보딩' 절차를 따르세요"
}

# ── 5/5 OCR venv (오프라인 휠 + 한국어 모델) ─────────────────
Write-Host "==> 5/5  OCR venv"
$py = $null
try { $py = (& py -3.12 -c "import sys;print(sys.executable)" 2>$null) } catch {}
if (-not $py) { try { $py = (& python -c "import sys;print(sys.executable)" 2>$null) } catch {} }

if (-not $py) {
  Write-Warning "Python 3.12 미설치 — OCR venv 를 건너뜁니다(문서작성·광고심의 OCR/HWPX Python 기동 불가)."
  Write-Host  "  OCR/HWPX 쓰려면 Python 설치 후:"
  Write-Host  "    Start-Process `"$Bundle\python-3.12.10-amd64.exe`" -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_launcher=1' -Wait"
  Write-Host  "    powershell -ExecutionPolicy Bypass -File infra\offline\setup-ocr-windows.ps1"
} else {
  & "$PSScriptRoot\setup-ocr-windows.ps1" -Prefix $Prefix
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $py = "$Prefix\ocr\venv\Scripts\python.exe"
}

Write-Host ""
Write-Host "[OK] 설치 완료. 남은 작업:"
Write-Host "  1) .env.local 작성:  copy .env.example .env.local  후 편집"
Write-Host "       MONGODB_URI=mongodb://127.0.0.1:27017   MONGODB_DB=axplayground"
Write-Host "       SESSION_SECRET(32자+)   ADMIN_ACCESS_KEY(8자+)"
Write-Host "       OPENAI_COMPATIBLE_BASE_URL=http://<내부LLM>/v1   OPENAI_COMPATIBLE_MODEL=<모델>"
if ($py) {
  Write-Host "       OCR_PROVIDER=python"
  Write-Host "       PYTHON_BIN=$Prefix\ocr\venv\Scripts\python.exe"
  Write-Host "       (문서작성 HWPX·광고심의 OCR 모두 PYTHON_BIN 사용 — UTF-8 코드 반영 필요)"
} else {
  Write-Host "       OCR_PROVIDER=none   (Python 미설치로 OCR/HWPX 건너뜀)"
}
Write-Host "       LLM_TIMEOUT_MS=120000   (Ollama hung 방지, 선택)"
Write-Host "  2) 기동(이 PowerShell 세션은 PATH 에 node 가 잡혀 있음):"
Write-Host "       npm run dev          # http://127.0.0.1:3000"
Write-Host "  * mongod 는 이 세션에서 백그라운드로 떴습니다. 재부팅 후엔 다시 기동하거나 Windows 서비스로 등록하세요:"
Write-Host "       `"$MongoBin\mongod.exe`" --dbpath `"$Prefix\data`" --bind_ip 127.0.0.1 --logpath `"$Prefix\log\mongod.log`""
Write-Host "  * 새 PowerShell 창에서 node/npm 을 쓰려면 PATH 에 추가:  `$env:Path = `"$NodeDir;`$env:Path`""
