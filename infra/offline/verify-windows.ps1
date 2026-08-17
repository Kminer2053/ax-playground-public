<#
  AX Playground - Windows closed-network verify (Node, SWC, Mongo, Python, OCR)
  Run from repo root:
    powershell -ExecutionPolicy Bypass -File infra\offline\verify-windows.ps1
#>
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$Prefix = if ($env:AXP_PREFIX) { $env:AXP_PREFIX } else { "C:\axp" }
$Report = Join-Path $Root "verify-windows-report.txt"
$script:ok = 0
$script:warn = 0
$script:fail = 0

function Log([string]$level, [string]$msg) {
  $line = "[$level] $msg"
  Write-Host $line
  Add-Content -Path $Report -Value $line -Encoding UTF8
  switch ($level) {
    "OK" { $script:ok++ }
    "WARN" { $script:warn++ }
    "FAIL" { $script:fail++ }
  }
}

Remove-Item $Report -Force -ErrorAction SilentlyContinue
Log "INFO" "=== AX Playground Windows verify ==="
Log "INFO" "Root: $Root"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node) {
  $ver = & node -v 2>$null
  Log "OK" "Node: $node ($ver)"
} else {
  Log "FAIL" "Node missing - run install-offline.ps1 or install Node MSI/ZIP"
}

if ($node) {
  $swcJs = Join-Path $env:TEMP "ax-verify-swc.js"
  $swcMod = (Join-Path $Root "node_modules\@next\swc-win32-x64-msvc").Replace('\', '/')
  @("require('$swcMod');", "console.log('SWC OK');") | Set-Content $swcJs -Encoding UTF8
  $p = Start-Process -FilePath $node -ArgumentList @($swcJs) -WorkingDirectory $Root -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput "$env:TEMP\ax-swc-out.txt" -RedirectStandardError "$env:TEMP\ax-swc-err.txt"
  $out = (Get-Content "$env:TEMP\ax-swc-out.txt" -Raw -ErrorAction SilentlyContinue).Trim()
  if ($out -match "SWC OK") { Log "OK" "SWC: $out" }
  elseif ($p.ExitCode -eq -1073741819 -or $p.ExitCode -eq 3221225477) {
    Log "FAIL" "SWC ACCESS_VIOLATION - SecureGate/AhnLab may block .node (see diagnose-swc-windows.ps1)"
  } else {
    Log "FAIL" "SWC load failed exit=$($p.ExitCode)"
  }
}

try {
  $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -WarningAction SilentlyContinue
  if ($tcp.TcpTestSucceeded) { Log "OK" "MongoDB 127.0.0.1:27017 LISTEN" }
  else { Log "FAIL" "MongoDB port 27017 not responding - start mongod" }
} catch {
  Log "WARN" "MongoDB port check failed: $_"
}

$envLocal = Join-Path $Root ".env.local"
if (Test-Path $envLocal) {
  Log "OK" ".env.local exists"
  $text = Get-Content $envLocal -Raw
  foreach ($key in @("MONGODB_URI", "SESSION_SECRET", "OPENAI_COMPATIBLE_BASE_URL", "OPENAI_COMPATIBLE_MODEL")) {
    if ($text -match "$key\s*=") { Log "OK" "  $key set" } else { Log "WARN" "  $key missing" }
  }
  if ($text -match "PYTHON_BIN\s*=") {
    if ($text -match "PYTHON_BIN\s*=\s*(.+)") { Log "OK" "  PYTHON_BIN=$($Matches[1].Trim())" }
  } else {
    Log "WARN" "  PYTHON_BIN missing - docs HWPX and ad OCR will fail. Use C:\axp\ocr\venv\Scripts\python.exe"
  }
  if ($text -match "OCR_PROVIDER\s*=") { Log "OK" "  OCR_PROVIDER set" }
  else { Log "WARN" "  OCR_PROVIDER missing (defaults to python, needs PYTHON_BIN)" }
} else {
  Log "FAIL" ".env.local missing - copy .env.example .env.local"
}

$defaultPy = Join-Path $Prefix "ocr\venv\Scripts\python.exe"
$pyBin = $defaultPy
if (Test-Path $envLocal) {
  $m = [regex]::Match((Get-Content $envLocal -Raw), "PYTHON_BIN\s*=\s*(.+)")
  if ($m.Success) { $pyBin = $m.Groups[1].Value.Trim() }
}

if (Test-Path $pyBin) {
  Log "OK" "Python: $pyBin"
  $rapid = & $pyBin -c "import rapidocr; print('rapidocr OK')" 2>&1
  if ($rapid -match "rapidocr OK") { Log "OK" "  $rapid" }
  else { Log "FAIL" "  rapidocr import failed - run setup-ocr-windows.ps1" }
  $ocrScript = Join-Path $Root "tools\ocr\ocr_rapidocr.py"
  $sample = Get-ChildItem "$Root\public" -Recurse -Include *.png,*.jpg -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($sample -and (Test-Path $ocrScript)) {
    Log "INFO" "OCR script test: $($sample.Name)"
    $ocrOut = & $pyBin $ocrScript $sample.FullName 2>&1 | Out-String
    if ($ocrOut -match '\{"lines"') { Log "OK" "  OCR JSON output OK" }
    else {
      $head = if ($ocrOut.Length -gt 120) { $ocrOut.Substring(0, 120) } else { $ocrOut }
      Log "WARN" "  OCR output check: $head"
    }
  }
} else {
  Log "FAIL" "Python missing: $pyBin - run setup-ocr-windows.ps1"
}

$bundle = Join-Path $Root "infra\offline\bundle-win"
if (Test-Path $bundle) {
  Log "OK" "bundle-win exists"
  if (Test-Path (Join-Path $bundle "ocr\wheelhouse")) { Log "OK" "  ocr\wheelhouse OK" }
  else { Log "WARN" "  ocr\wheelhouse missing" }
} else {
  Log "WARN" "bundle-win missing - USB import needed for OCR rebuild"
}

Log "INFO" "Summary: OK=$($script:ok) WARN=$($script:warn) FAIL=$($script:fail)"
Log "INFO" "Report: $Report"
if ($script:fail -gt 0) { exit 1 }
