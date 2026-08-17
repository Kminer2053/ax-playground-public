<#
  GitHub main -> 내부망 Gitea 증분 반입용 git bundle 생성 (외부망)

  기준 커밋(BASE)은 내부망에 이미 반영된 HEAD.
  기본값: infra/offline/git-bundle-base.txt (내부망 apply 스크립트가 갱신)

  실행 (리포 루트):
    powershell -ExecutionPolicy Bypass -File infra\offline\export-git-bundle-incremental.ps1
    powershell -ExecutionPolicy Bypass -File infra\offline\export-git-bundle-incremental.ps1 -Base de38d21

  출력: infra\offline\ax-playground-update.bundle (+ 날짜 복사본)
#>
param(
  [string]$Base = "",
  [string]$Output = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$baseFile = Join-Path $Root "infra\offline\git-bundle-base.txt"
$date = Get-Date -Format "yyyyMMdd"

if (-not $Base) {
  if (-not (Test-Path -LiteralPath $baseFile)) {
    throw "BASE commit required. Pass -Base <hash> or create $baseFile"
  }
  $Base = (Get-Content -LiteralPath $baseFile -Raw).Trim()
}
if (-not $Base) { throw "BASE commit is empty." }

if (-not $Output) {
  $Output = Join-Path $Root "infra\offline\ax-playground-update.bundle"
}

Push-Location $Root
try {
  git fetch origin | Out-Null
  git checkout main | Out-Null
  git pull origin main | Out-Null

  $head = (git rev-parse HEAD).Trim()
  $shortBase = (git rev-parse --short $Base).Trim()
  $shortHead = (git rev-parse --short HEAD).Trim()

  if ($head -eq (git rev-parse $Base).Trim()) {
    Write-Host "No new commits ($shortHead). Bundle not created."
    exit 0
  }

  $range = "${Base}..origin/main"
  Write-Host "==> git bundle create  $range"
  git bundle create $Output $range
  if ($LASTEXITCODE -ne 0) { throw "git bundle create failed" }

  git bundle verify $Output
  git bundle list-heads $Output

  $dated = Join-Path $Root "infra\offline\ax-playground-update-$date.bundle"
  Copy-Item -LiteralPath $Output -Destination $dated -Force

  Write-Host ""
  Write-Host "OK  $Output"
  Write-Host "    $dated"
  Write-Host "BASE (internal): $Base"
  Write-Host "HEAD (GitHub):   $head"
  Write-Host ""
  Write-Host "Next:"
  Write-Host "  1) USB -> C:\HANSSAK\SecureGate\Download\ax-playground-update.bundle"
  Write-Host "  2) Internal: infra\offline\apply-git-bundle-incremental.bat"
}
finally {
  Pop-Location
}
