<#
  AX Playground — Windows OCR venv 구성 (문서작성·광고심의 OCR 공통)
  ──────────────────────────────────────────────────────────────────────────
  install-offline.ps1 5단계만 단독 실행. Python 3.12 + bundle-win\ocr 휠·모델 필요.
  실행 (리포 루트):
    powershell -ExecutionPolicy Bypass -File infra\offline\setup-ocr-windows.ps1
  Python 미설치 시 bundle-win\python-3.12.10-amd64.exe 로 먼저 설치:
    Start-Process .\infra\offline\bundle-win\python-3.12.10-amd64.exe `
      -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_launcher=1' -Wait
  (설치 후 새 PowerShell 창에서 이 스크립트 재실행)
#>
param(
  [string]$Prefix = $(if ($env:AXP_PREFIX) { $env:AXP_PREFIX } else { "C:\axp" })
)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$Bundle = Join-Path $Root "infra\offline\bundle-win"
$WheelHouse = Join-Path $Bundle "ocr\wheelhouse"
$ModelsCache = Join-Path $Bundle "ocr\models_cache"
$Req = Join-Path $Root "tools\ocr\requirements.txt"
$VenvPy = Join-Path $Prefix "ocr\venv\Scripts\python.exe"

if (-not (Test-Path $Bundle)) { throw "$Bundle 없음 — bundle-win 을 USB로 반입하세요." }
if (-not (Test-Path $WheelHouse)) { throw "$WheelHouse 없음 — fetch-offline-bundle.ps1 로 조립하세요." }
if (-not (Test-Path $ModelsCache)) { throw "$ModelsCache 없음 — OCR 모델 캐시가 없습니다." }

$py = $null
foreach ($cmd in @("py -3.12", "python")) {
  try {
    $py = Invoke-Expression "& $cmd -c `"import sys;print(sys.executable)`" 2>`$null"
    if ($py) { break }
  } catch {}
}
if (-not $py) {
  Write-Host ""
  Write-Host "[FAIL] Python 3.12 미설치."
  $msi = Get-ChildItem "$Bundle\python-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($msi) {
    Write-Host "  설치: Start-Process `"$($msi.FullName)`" -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_launcher=1' -Wait"
  }
  Write-Host "  설치 후 **새 PowerShell** 에서 이 스크립트를 다시 실행하세요."
  exit 1
}

Write-Host "==> Python: $py"
Write-Host "==> OCR venv: $VenvPy"

New-Item -ItemType Directory -Force -Path "$Prefix\ocr" | Out-Null
& py -3.12 -m venv "$Prefix\ocr\venv" 2>$null
if (-not (Test-Path $VenvPy)) { & python -m venv "$Prefix\ocr\venv" }
if (-not (Test-Path $VenvPy)) { throw "venv 생성 실패: $VenvPy" }

Write-Host "==> pip install (offline wheelhouse)"
& $VenvPy -m pip install --no-index --find-links "$WheelHouse" -r "$Req"
& $VenvPy -m pip uninstall -y opencv-python opencv-python-headless 2>$null
& $VenvPy -m pip install --no-index --find-links "$WheelHouse" opencv-python-headless==4.13.0.92

$Rd = (& $VenvPy -c "import rapidocr,os;print(os.path.dirname(rapidocr.__file__))").Trim()
New-Item -ItemType Directory -Force -Path "$Rd\models" | Out-Null
Copy-Item "$ModelsCache\*" "$Rd\models\" -Force

Write-Host "==> rapidocr import test"
& $VenvPy -c "import rapidocr; print('rapidocr OK')"

Write-Host ""
Write-Host "[OK] OCR venv 준비 완료."
Write-Host "  .env.local 에 아래 두 줄을 **반드시** 추가하세요 (문서작성·광고심의 OCR 공통):"
Write-Host "    OCR_PROVIDER=python"
Write-Host "    PYTHON_BIN=$VenvPy"
Write-Host ""
Write-Host "  검증: powershell -ExecutionPolicy Bypass -File infra\offline\verify-windows.ps1"
