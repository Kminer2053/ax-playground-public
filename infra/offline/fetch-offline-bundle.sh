#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 폐쇄망 오프라인 번들 조립  ─  [인터넷 연결된 Ubuntu 24.04 / amd64 머신에서 실행]
#
# 이 스크립트가 모은 infra/offline/bundle/ 을 운영(폐쇄망) 서버로 반입한 뒤
# install-offline.sh 로 설치한다.  자세한 맥락: ./README.md, ../../docs/OFFLINE_INSTALL.md
#
# ※ LLM(Ollama)·모델은 번들에 포함하지 않는다 — 이미 폐쇄망(대상 서버 또는 내부 LLM 서버)에
#   탑재돼 있다는 전제. 앱은 OPENAI_COMPATIBLE_BASE_URL 로 그 LLM에 연결만 한다.
#
# 전제: 이 리포가 연결된 amd64 머신에 클론돼 있고 node20·npm·python3.12 설치됨.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/../.."                 # → 리포 루트
ROOT="$(pwd)"; BUNDLE="$ROOT/infra/offline/bundle"; mkdir -p "$BUNDLE"

############################ CONFIG (환경에 맞게 수정) ##########################
NODE_VERSION="${NODE_VERSION:-20.18.1}"                 # 운영서버 Node LTS
MONGO_VERSION="${MONGO_VERSION:-7.0.14}"                # MongoDB Community
TOOLS_VERSION="${TOOLS_VERSION:-100.10.0}"             # MongoDB Database Tools
###############################################################################

dl(){ echo "  ↓ $2"; curl -fsSL "$1" -o "$2"; }

echo "==> 1/4  Node.js $NODE_VERSION (linux-x64)"
dl "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" \
   "$BUNDLE/node-v$NODE_VERSION-linux-x64.tar.xz"

echo "==> 2/4  node_modules (amd64 네이티브 포함) — npm ci 후 압축"
npm ci
tar czf "$BUNDLE/node_modules.tgz" node_modules

echo "==> 3/4  MongoDB Community + Database Tools (ubuntu2404 x86_64)"
dl "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-$MONGO_VERSION.tgz" \
   "$BUNDLE/mongodb-$MONGO_VERSION.tgz"
dl "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2404-x86_64-$TOOLS_VERSION.tgz" \
   "$BUNDLE/mongodb-database-tools-$TOOLS_VERSION.tgz"
# (대안) docker 방식:  docker pull mongo:7 && docker save mongo:7 | gzip > "$BUNDLE/mongo7-image.tar.gz"

echo "==> 4/4  OCR 휠하우스 + 한국어 모델 (Ubuntu24/py3.12/amd64)"
# 상세: tools/ocr/README.md 방식 (a). 반드시 ubuntu24/py3.12/amd64(또는 그 도커)에서 받아야 휠이 운영서버와 맞음.
mkdir -p "$BUNDLE/ocr/wheelhouse" "$BUNDLE/ocr/models_cache"
pip download -r tools/ocr/requirements.txt -d "$BUNDLE/ocr/wheelhouse"
pip download opencv-python-headless==4.13.0.92 -d "$BUNDLE/ocr/wheelhouse"
# 한국어 PP-OCRv5 모델 1회 받아 캐시 추출
TMPV="$(mktemp -d)"; python3.12 -m venv "$TMPV"
"$TMPV/bin/pip" install -r tools/ocr/requirements.txt >/dev/null
"$TMPV/bin/python" -c "from rapidocr import RapidOCR,LangRec,OCRVersion; RapidOCR(params={'Rec.lang_type':LangRec.KOREAN,'Rec.ocr_version':OCRVersion.PPOCRV5})"
cp -r "$("$TMPV/bin/python" -c 'import rapidocr,os;print(os.path.dirname(rapidocr.__file__))')/models/." "$BUNDLE/ocr/models_cache/"
rm -rf "$TMPV"

echo ""
echo "✅ 완료 — 반입 대상: $BUNDLE   (LLM/Ollama 모델은 이미 폐쇄망 탑재 → 번들 제외)"
du -sh "$BUNDLE"/* 2>/dev/null || true
echo "이 bundle/ (또는 리포 전체)을 운영 서버로 반입 후  bash infra/offline/install-offline.sh"
