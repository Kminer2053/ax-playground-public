<#
  내부망 Linux 반입용 증분 zip (OS 의존 파일 제외)
  - 포함: 변경 소스·package.json·RAG BSON 6개·작업 안내서
  - 제외: node_modules · .next · dump 비-RAG 컬렉션 · benchmark · reverse-engineering

  실행 (리포 루트):
    powershell -ExecutionPolicy Bypass -File infra\offline\pack-update-internal.ps1
    powershell -ExecutionPolicy Bypass -File infra\offline\pack-update-internal.ps1 -Prev 2a75268

  출력: infra\offline\ax-update-internal-YYYYMMDD.zip
#>
param(
  [string]$Prev = "2a75268"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$date = Get-Date -Format "yyyyMMdd"
$outZip = Join-Path $Root "infra\offline\ax-update-internal-$date.zip"

Push-Location $Root
try {
  $head = (git rev-parse --short HEAD).Trim()
  Write-Host "==> diff $Prev..HEAD ($head)"

  $files = git diff "$Prev..HEAD" --name-only --diff-filter=ACMR |
    ForEach-Object { $_.Trim().Trim('"') } |
    Where-Object { $_ } |
    Where-Object { $_ -notmatch '^data/mongo-snapshot/dump-2026-06-25' } |
    Where-Object { $_ -notmatch '^data/benchmark/' } |
    Where-Object { $_ -notmatch '^docs/reverse-engineering/' } |
    Where-Object {
      if ($_ -match '^data/mongo-snapshot/dump-2026-07-04/') {
        $_ -match 'rag_regulation|rag_vectors|rag_graph_edges'
      } else { $true }
    }

  $stage = Join-Path $env:TEMP "ax-update-internal-stage"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  $copied = 0
  foreach ($rel in $files) {
    $relWin = $rel -replace '/', '\'
    $src = Join-Path $Root $relWin
    if (-not (Test-Path -LiteralPath $src)) {
      Write-Warning "skip (없음): $rel"
      continue
    }
    $dest = Join-Path $stage $relWin
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dest -Force
    $copied++
  }

  # 반입 체크리스트
  @"
AX Playground 내부망 반입 패키지
생성: $(Get-Date -Format 'yyyy-MM-dd HH:mm')
git: $Prev..$head ($copied files)

[포함] 변경 소스, package.json/lock, public/sagyu.json, RAG BSON 6개, update-rag-db.sh
[별도 반입] Linux node_modules (npm ci on Ubuntu/WSL)
[제외] node_modules, .next, .env.local

Linux 서버:
  unzip -o ax-update-internal-$date.zip -d `$APP_ROOT
  bash scripts/update-rag-db.sh data/mongo-snapshot/dump-2026-07-04
  npm run build && systemctl restart ax-playground

안내: docs/CLOSED_NETWORK_LINUX_UPDATE.md
"@ | Set-Content -Path (Join-Path $stage "INTERNAL_UPDATE_README.txt") -Encoding utf8

  if (Test-Path $outZip) { Remove-Item $outZip -Force }
  Compress-Archive -Path "$stage\*" -DestinationPath $outZip -Force
  Remove-Item $stage -Recurse -Force

  $mb = [math]::Round((Get-Item $outZip).Length / 1MB, 2)
  Write-Host "[OK] $outZip  ($copied files, ${mb} MB)"
  Write-Host "  node_modules 는 WSL/Ubuntu 에서 별도 tar 반입"
} finally {
  Pop-Location
}
