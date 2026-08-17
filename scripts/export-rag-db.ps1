# Export RAG 3 collections only (Windows PowerShell).
#
#   powershell -ExecutionPolicy Bypass -File scripts\export-rag-db.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\export-rag-db.ps1 -Out "data\mongo-snapshot\rag-update-20260706" -Tools "C:\Program Files\MongoDB\Tools\100\bin"

param(
  [string]$Uri = $(if ($env:MONGODB_URI) { $env:MONGODB_URI } else { "mongodb://127.0.0.1:27017" }),
  [string]$Db = $(if ($env:MONGODB_DB) { $env:MONGODB_DB } else { "axplayground" }),
  [string]$Out = ("data\mongo-snapshot\rag-update-" + (Get-Date -Format "yyyyMMdd")),
  [string]$Tools = ""
)
$ErrorActionPreference = "Stop"

function Invoke-MongoNative {
  param([string]$Exe, [string[]]$ToolArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $Exe @ToolArgs 2>&1 | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return $code
}

$mongodump = if ($Tools) { Join-Path $Tools "mongodump.exe" } else { "mongodump" }

Write-Host ">> RAG dump  URI=$Uri  DB=$Db  -> $Out"
foreach ($C in @("rag_regulation", "rag_vectors", "rag_graph_edges")) {
  $code = Invoke-MongoNative $mongodump @("--uri=$Uri", "--db=$Db", "--collection=$C", "--out=$Out")
  if ($code -ne 0) { throw "mongodump failed: $C (exit $code)" }
}

Write-Host ""
Write-Host ">> output"
Get-ChildItem -Path (Join-Path $Out $Db) -Filter *.bson | ForEach-Object {
  "{0,10:N0} KB  {1}" -f ($_.Length / 1KB), $_.Name | Write-Host
}
Write-Host ""
Write-Host "OK. On deploy server:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\update-rag-db.ps1 -Dump `"$Out`""
