<#
  AX Playground 폐쇄망 오프라인 번들 조립 — 네이티브 Windows 대상
  ──────────────────────────────────────────────────────────────────────────
  [인터넷 연결된 Windows(amd64) 머신에서 실행] → infra\offline\bundle-win\ 생성 → 폐쇄망 반입.
  설치는 install-offline.ps1. LLM(Ollama/OpenAI호환)은 폐쇄망 기존 탑재 전제라 번들 제외.
  전제: 이 머신에 git 클론된 리포 + Node(npm) + Python 3.12(+pip) 설치.
  실행:  powershell -ExecutionPolicy Bypass -File infra\offline\fetch-offline-bundle.ps1
#>
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$W    = Join-Path $Root "infra\offline\bundle-win"
New-Item -ItemType Directory -Force -Path "$W\ocr\wheelhouse","$W\ocr\models_cache" | Out-Null

############################ CONFIG (환경에 맞게 수정) ##########################
$NODE_VERSION   = "22.12.0"      # 운영 Node (linux 번들과 major 일치 권장)
$MONGO_VERSION  = "7.0.14"       # MongoDB Community (Windows)
$TOOLS_VERSION  = "100.10.0"     # MongoDB Database Tools (Windows)
$PYTHON_VERSION = "3.12.10"      # Windows Python 설치본
###############################################################################

function Dl($url, $out) { Write-Host "  v $out"; Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing }

Write-Host "==> 1/5  Node.js $NODE_VERSION (win-x64)"
Dl "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" "$W\node-v$NODE_VERSION-win-x64.zip"

Write-Host "==> 2/5  MongoDB $MONGO_VERSION + Database Tools $TOOLS_VERSION (windows x86_64)"
Dl "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-$MONGO_VERSION.zip" "$W\mongodb-windows-x86_64-$MONGO_VERSION.zip"
Dl "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-windows-x86_64-$TOOLS_VERSION.zip" "$W\mongodb-database-tools-windows-x86_64-$TOOLS_VERSION.zip"

Write-Host "==> 3/5  Python $PYTHON_VERSION (Windows 설치본)"
Dl "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-amd64.exe" "$W\python-$PYTHON_VERSION-amd64.exe"

Write-Host "==> 4/5  OCR 휠 (win_amd64 / cp312)"
# 박스 자체 Python 버전과 무관하게 타깃(win/py3.12)용 휠을 받도록 명시 지정.
& python -m pip download --only-binary=:all: --python-version 3.12 --implementation cp --abi cp312 `
  --platform win_amd64 -r (Join-Path $Root "tools\ocr\requirements.txt") -d "$W\ocr\wheelhouse"

Write-Host "==> 5/5  한국어 PP-OCRv5 모델 (.onnx, 플랫폼 무관)"
$base = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.8.0/onnx"
Dl "$base/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile.onnx"        "$W\ocr\models_cache\korean_PP-OCRv5_rec_mobile.onnx"
Dl "$base/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx"            "$W\ocr\models_cache\ch_PP-OCRv4_det_mobile.onnx"
Dl "$base/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx"   "$W\ocr\models_cache\ch_ppocr_mobile_v2.0_cls_mobile.onnx"

Write-Host ""
Write-Host "[OK] bundle-win 조립 완료: $W"
Write-Host "  ※ node_modules-win.zip 은 이 스크립트가 만들지 않습니다 — Windows에서 'npm ci' 후 직접 압축:"
Write-Host "      npm ci ; Compress-Archive -Path node_modules -DestinationPath `"$W\node_modules-win.zip`" -Force"
Write-Host "  이 bundle-win\ (+ node_modules-win.zip) 과 소스를 폐쇄망 반입 후  install-offline.ps1 실행."
