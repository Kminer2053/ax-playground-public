<#
  USB 반입용 소스 압축 (node_modules·.next·git 제외)
  실행: powershell -ExecutionPolicy Bypass -File infra\offline\pack-source-for-usb.ps1
  출력: infra\offline\ax-playground-source.zip (리포 루트 기준)
#>
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$Out = Join-Path $Root "infra\offline\ax-playground-source.zip"
$Stage = Join-Path $env:TEMP "ax-playground-usb-stage"

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

Write-Host "==> staging (exclude node_modules, .next, .git) ..."
robocopy $Root $Stage /MIR /XD node_modules .next .git /XF *.zip swc-diagnose-report.txt verify-windows-report.txt /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

if (Test-Path $Out) { Remove-Item $Out -Force }
Compress-Archive -Path "$Stage\*" -DestinationPath $Out -Force
Remove-Item $Stage -Recurse -Force

Write-Host "[OK] $Out"
Write-Host "  폐쇄망 PC: 압축 해제 후 기존 ax-playground 에 덮어쓰기 (node_modules 는 유지)"
