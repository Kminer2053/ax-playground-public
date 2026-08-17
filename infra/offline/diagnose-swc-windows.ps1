<#
  Next.js SWC Windows diagnostic (closed network / SecureGate)
  Run in cmd (one line at a time):
    cd /d C:\Users\INTERNAL\ax-playground
    powershell -ExecutionPolicy Bypass -File infra\offline\diagnose-swc-windows.ps1
  Output: swc-diagnose-report.txt in repo root
#>
$ErrorActionPreference = "Continue"
$Root = try { (Resolve-Path "$PSScriptRoot\..\..").Path } catch { (Get-Location).Path }
$Prefix = if ($env:AXP_PREFIX) { $env:AXP_PREFIX } else { "C:\axp" }
$NodeDir = Join-Path $Prefix "node\node-v22.12.0-win-x64"
$Node = Join-Path $NodeDir "node.exe"
if (-not (Test-Path $Node)) {
  $Node = (Get-Command node -ErrorAction SilentlyContinue).Source
}
$SwcNode = Join-Path $Root "node_modules\@next\swc-win32-x64-msvc\next-swc.win32-x64-msvc.node"
$Report = Join-Path $Root "swc-diagnose-report.txt"
$TmpDir = Join-Path $env:TEMP "ax-swc-diag"
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

$ExpectedSize = 127985152
$ExpectedSha256 = "6af575ac3af3dde46c94fcf02cd3b2003fb659afb74f9b7d4f2b3969d7f2b49e"

function Log([string]$msg) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
  Write-Host $line
  Add-Content -Path $Report -Value $line -Encoding UTF8
}

function Run-NodeScript([string]$scriptPath, [string]$label) {
  if (-not (Test-Path $Node)) {
    Log "SKIP $label - node.exe missing: $Node"
    return $null
  }
  Log "RUN: $label ($scriptPath)"
  $outFile = Join-Path $TmpDir "out-$label.txt"
  $errFile = Join-Path $TmpDir "err-$label.txt"
  $p = Start-Process -FilePath $Node -ArgumentList @($scriptPath) -WorkingDirectory $Root -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  if (Test-Path $outFile) {
    $out = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($out) { Log "stdout: $out" }
  }
  if (Test-Path $errFile) {
    $err = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($err) { Log "stderr: $err" }
  }
  $code = $p.ExitCode
  $hex = if ($null -ne $code) { "0x{0:X8}" -f [uint32]$code } else { "?" }
  Log "exit: $code ($hex)"
  if ($code -eq -1073741819 -or $code -eq 3221225477) {
    Log "  >> ACCESS_VIOLATION 0xC0000005 - native crash loading .node DLL"
  }
  return $code
}

Remove-Item $Report -Force -ErrorAction SilentlyContinue
Log "=== SWC diagnostic @next/swc-win32-x64-msvc ==="
Log "Root: $Root"
Log "Node: $Node"
Log ""

@'
console.log("hello");
'@ | Set-Content (Join-Path $TmpDir "hello.js") -Encoding UTF8

@'
console.log("arch=" + process.arch + " napi=" + process.versions.napi);
'@ | Set-Content (Join-Path $TmpDir "arch.js") -Encoding UTF8

@'
require("@next/swc-win32-x64-msvc");
console.log("SWC OK");
'@ | Set-Content (Join-Path $TmpDir "swc-require.js") -Encoding UTF8
# require() resolves from script dir — repo root 기준 절대 경로 사용
$swcMod = (Join-Path $Root "node_modules\@next\swc-win32-x64-msvc").Replace('\', '/')
@("require('$swcMod');", "console.log('SWC OK');") | Set-Content (Join-Path $TmpDir "swc-require-abs.js") -Encoding UTF8

Log "--- 1. Node basics ---"
Run-NodeScript (Join-Path $TmpDir "hello.js") "hello"
Run-NodeScript (Join-Path $TmpDir "arch.js") "arch"

Log ""
Log "--- 2. SWC file integrity ---"
if (-not (Test-Path $SwcNode)) {
  Log "FAIL: missing $SwcNode"
} else {
  $fi = Get-Item $SwcNode
  Log "size: $($fi.Length) expected: $ExpectedSize"
  if ($fi.Length -eq $ExpectedSize) { Log "OK size match" } else { Log "WARN size mismatch" }
  try {
    $hash = (Get-FileHash $SwcNode -Algorithm SHA256).Hash.ToLower()
    Log "sha256: $hash"
    if ($hash -eq $ExpectedSha256) { Log "OK hash match (same as external npm ci build)" }
    else { Log "WARN hash mismatch - corrupt zip or different Next version" }
  } catch { Log "WARN hash failed: $_" }
}

Log ""
Log "--- 3. SWC require (core test) ---"
$swcExit = Run-NodeScript (Join-Path $TmpDir "swc-require-abs.js") "swc-require"

Log ""
Log "--- 4. Isolated path load ---"
$iso = Join-Path $Prefix "swc-test.node"
if (Test-Path $SwcNode) {
  Copy-Item $SwcNode $iso -Force
  @'
const mod = process.argv[1];
require(mod);
console.log("ISO SWC OK");
'@ | Set-Content (Join-Path $TmpDir "swc-iso.js") -Encoding UTF8
  if (-not (Test-Path $Node)) { Log "SKIP iso" } else {
    Log "RUN: load from $iso"
    $p = Start-Process -FilePath $Node -ArgumentList @((Join-Path $TmpDir "swc-iso.js"), $iso) `
      -WorkingDirectory $Root -Wait -PassThru -NoNewWindow
    Log "exit: $($p.ExitCode)"
  }
  Remove-Item $iso -Force -ErrorAction SilentlyContinue
}

Log ""
Log "--- 5. VC++ 2015-2022 x64 ---"
foreach ($dll in @("vcruntime140.dll", "msvcp140.dll", "vcruntime140_1.dll")) {
  $p = Join-Path $env:SystemRoot "System32\$dll"
  if (Test-Path $p) { Log "OK $dll" } else { Log "MISSING $dll" }
}
$vcKey = "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
if (Test-Path $vcKey) {
  $vc = Get-ItemProperty $vcKey
  Log "OK VC++ registry Version=$($vc.Version)"
} else {
  Log "MISSING VC++ x64 registry - install vc_redist.x64.exe"
}

Log ""
Log "--- 6. Security software hints ---"
# 국내 폐쇄망 PC에서 흔한 엔드포인트 보안 솔루션 예시 목록 - 환경에 맞게 패턴 조정
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "V3|AhnLab|SecureGate|GnPC|Inspector" } |
  ForEach-Object { Log "PROC $($_.ProcessName)" }

Log ""
Log "--- 7. Application Error events (3d, node/swc) ---"
try {
  $since = (Get-Date).AddDays(-3)
  Get-WinEvent -FilterHashtable @{ LogName = "Application"; Level = 2; StartTime = $since } -MaxEvents 300 -ErrorAction Stop |
    Where-Object { $_.Message -match "node\.exe|next-swc|swc" } | Select-Object -First 8 |
    ForEach-Object { Log "EVENT: $($_.TimeCreated) $($_.Message.Substring(0,[Math]::Min(200,$_.Message.Length)))" }
} catch { Log "no matching events or access denied" }

Log ""
Log "=== Verdict ==="
if (-not (Test-Path $SwcNode)) {
  Log "A) Re-extract node_modules-win.zip"
} elseif ($swcExit -eq -1073741819 -or $swcExit -eq 3221225477) {
  Log "B) SWC ACCESS_VIOLATION - Node OK, .node load blocked/crashed"
  Log "   1) Install VC++ 2015-2022 x64, reboot"
  Log "   2) IT whitelist: node.exe + next-swc.win32-x64-msvc.node (SecureGate/AhnLab)"
  Log "   3) If size+hash OK -> likely security hook not file corruption"
} elseif ($swcExit -ne 0) {
  Log "C) SWC load failed exit=$swcExit - see stderr above"
} else {
  Log "D) SWC OK - if next dev fails check .env MongoDB port"
}
Log "Report: $Report"
