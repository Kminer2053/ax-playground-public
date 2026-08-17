# Update RAG 3 collections only on an existing DB (Windows PowerShell).
#   rag_regulation, rag_vectors, rag_graph_edges
#
# Does NOT touch: playgroundconfigs, guardconfigs, featureusages, ontology_*, etc.
#
# Run from repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\update-rag-db.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\update-rag-db.ps1 -Dump "data\mongo-snapshot\dump-2026-08-08" -Tools "C:\Program Files\MongoDB\Tools\100\bin"

param(
  [string]$Uri = $(if ($env:MONGODB_URI) { $env:MONGODB_URI } else { "mongodb://127.0.0.1:27017" }),
  [string]$Db = $(if ($env:MONGODB_DB) { $env:MONGODB_DB } else { "axplayground" }),
  [string]$Dump = "",
  [string]$Tools = ""
)
$ErrorActionPreference = "Stop"

# mongodump/mongorestore log to stderr; PS 5.1 + Stop treats that as fatal.
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
$mongorestore = if ($Tools) { Join-Path $Tools "mongorestore.exe" } else { "mongorestore" }

if (-not $Dump) {
  $cand = @(Get-ChildItem -Directory -Path "data\mongo-snapshot" -Filter "rag-update-*" -ErrorAction SilentlyContinue) +
          @(Get-ChildItem -Directory -Path "data\mongo-snapshot" -Filter "dump-*" -ErrorAction SilentlyContinue)
  $pick = $cand | Sort-Object Name | Select-Object -Last 1
  if ($pick) { $Dump = $pick.FullName }
}
if (-not $Dump -or -not (Test-Path -LiteralPath $Dump)) {
  throw "Dump not found. Pass -Dump <path> (run from repo root)."
}

$srcDir = Get-ChildItem -Directory -Path $Dump | Select-Object -First 1
if (-not $srcDir) { throw "Invalid dump layout (no DB subfolder): $Dump" }
$SrcDb = $srcDir.Name

Write-Host ">> RAG update  URI=$Uri  DB=$Db  Dump=$Dump"
Write-Host "   replace: rag_regulation, rag_vectors, rag_graph_edges"
Write-Host "   keep:    playgroundconfigs, guardconfigs, featureusages, ontology_*, content, runtime logs"
Write-Host ""

$Bk = "data\mongo-snapshot\rag-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss")
Write-Host ">> backup current RAG -> $Bk"
foreach ($C in @("rag_regulation", "rag_vectors", "rag_graph_edges")) {
  $code = Invoke-MongoNative $mongodump @("--uri=$Uri", "--db=$Db", "--collection=$C", "--out=$Bk")
  if ($code -ne 0) { Write-Host "   ($C backup skipped - collection may not exist)" }
}

Write-Host ">> restore (--drop, 3 collections)"
$restoreArgs = @(
  "--uri=$Uri", "--drop",
  "--nsInclude=$SrcDb.rag_regulation",
  "--nsInclude=$SrcDb.rag_vectors",
  "--nsInclude=$SrcDb.rag_graph_edges"
)
if ($Db -ne $SrcDb) { $restoreArgs += @("--nsFrom=$SrcDb.*", "--nsTo=$Db.*") }
$restoreArgs += $Dump
$code = Invoke-MongoNative $mongorestore $restoreArgs
if ($code -ne 0) {
  throw "mongorestore failed (exit $code). Rollback: mongorestore --uri=`"$Uri`" --drop $Bk"
}

Write-Host ""
Write-Host ">> verify"
$mongoshCmd = if ($Tools -and (Test-Path (Join-Path $Tools "mongosh.exe"))) { Join-Path $Tools "mongosh.exe" }
              elseif (Get-Command mongosh -ErrorAction SilentlyContinue) { "mongosh" }
              else { $null }
if ($mongoshCmd) {
  Invoke-MongoNative $mongoshCmd @("$Uri/$Db", "--quiet", "--eval", 'print("  rag_regulation: " + db.rag_regulation.countDocuments()); print("  rag_vectors:    " + db.rag_vectors.countDocuments()); print("  rag_graph_edges:" + db.rag_graph_edges.countDocuments());') | Out-Null
} else {
  Write-Host "   (mongosh not found - skip counts; check mongorestore log)"
}

Write-Host ""
Write-Host "OK. Next:"
Write-Host "  1) npm run sagyu:build  (if public\sagyu.json not in deploy)"
Write-Host "  2) Admin -> Settings -> RAG cache refresh  (or restart app)"
Write-Host "  3) Check embedding server (bge-m3)"
Write-Host "  4) Rollback: mongorestore --uri=`"$Uri`" --drop $Bk"
