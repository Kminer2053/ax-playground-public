#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 폐쇄망 오프라인 설치  ─  [운영 서버: Ubuntu 24.04 / amd64  또는  Windows WSL2(Ubuntu 24.04)]
#
# fetch-offline-bundle.sh 로 만든 infra/offline/bundle/ 을 반입한 뒤 리포 루트에서 실행.
# 멱등하지 않으므로 단계별로 점검하며 진행 권장. 자세한 설명: ../../docs/OFFLINE_INSTALL.md
#
# ※ LLM(Ollama)·모델은 설치하지 않는다 — 이미 폐쇄망에 탑재돼 있다는 전제.
#   앱 .env.local 의 OPENAI_COMPATIBLE_BASE_URL/MODEL 을 그 LLM 주소·모델로 맞추기만 하면 된다.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/../.."                 # → 리포 루트
ROOT="$(pwd)"; BUNDLE="$ROOT/infra/offline/bundle"
PREFIX="${PREFIX:-/opt/axp}"               # OCR venv 등 설치 베이스
[ -d "$BUNDLE" ] || { echo "✗ $BUNDLE 없음 — fetch-offline-bundle.sh 산출물을 반입하세요"; exit 1; }
sudo mkdir -p "$PREFIX"

echo "==> 1/5  Node.js"
sudo mkdir -p /opt/node
sudo tar -xf "$BUNDLE"/node-v*-linux-x64.tar.xz -C /opt/node --strip-components=1
sudo ln -sf /opt/node/bin/node /opt/node/bin/npm /opt/node/bin/npx /usr/local/bin/
export PATH=/opt/node/bin:$PATH; node -v

echo "==> 2/5  node_modules 복원"
tar xzf "$BUNDLE/node_modules.tgz" -C "$ROOT"

echo "==> 3/5  MongoDB 설치 + 기동(127.0.0.1)"
sudo tar -xf "$BUNDLE"/mongodb-[0-9]*.tgz -C /opt/
sudo tar -xf "$BUNDLE"/mongodb-database-tools-*.tgz -C /opt/
sudo ln -sf /opt/mongodb-linux-*/bin/* /opt/mongodb-database-tools-*/bin/* /usr/local/bin/
sudo mkdir -p /var/lib/mongo /var/log/mongodb
sudo chown -R "$USER" /var/lib/mongo /var/log/mongodb
mongod --dbpath /var/lib/mongo --bind_ip 127.0.0.1 --fork --logpath /var/log/mongodb/mongod.log
# (대안) docker:  docker load < "$BUNDLE/mongo7-image.tar.gz" && docker compose up -d
# (WSL: systemd 미사용 시 위 --fork 방식 그대로. systemd 켜면 서비스 등록 가능)

echo "==> 4/5  시드 덤프 복원 (axplayground)"
if compgen -G "$ROOT/data/mongo-snapshot/dump-*" > /dev/null; then
  mongorestore --uri="mongodb://127.0.0.1:27017" --drop "$ROOT"/data/mongo-snapshot/dump-*
else
  echo "    (건너뜀) data/mongo-snapshot/dump-* 없음 — 덤프는 리포에 미동봉. 빈 DB로 기동 후 README '초기 데이터 온보딩' 절차를 따르세요"
fi

echo "==> 5/5  OCR venv (오프라인 휠 + 한국어 모델)"
python3.12 -m venv "$PREFIX/ocr/venv"
"$PREFIX/ocr/venv/bin/pip" install --no-index --find-links "$BUNDLE/ocr/wheelhouse" -r "$ROOT/tools/ocr/requirements.txt"
"$PREFIX/ocr/venv/bin/pip" uninstall -y opencv-python opencv-python-headless 2>/dev/null || true
"$PREFIX/ocr/venv/bin/pip" install --no-index --find-links "$BUNDLE/ocr/wheelhouse" opencv-python-headless==4.13.0.92
mkdir -p "$PREFIX/ocr/venv/lib/python3.12/site-packages/rapidocr/models"
cp -r "$BUNDLE"/ocr/models_cache/. "$PREFIX/ocr/venv/lib/python3.12/site-packages/rapidocr/models/" 2>/dev/null || true

echo ""
echo "✅ 인프라 설치 완료. 남은 작업:"
echo "  1) .env.local 작성:  cp .env.example .env.local  후 편집"
echo "     필수: SESSION_SECRET(32자+), ADMIN_ACCESS_KEY, MONGODB_URI=mongodb://127.0.0.1:27017"
echo "     LLM(기존 폐쇄망 탑재):  OPENAI_COMPATIBLE_BASE_URL=<내부 LLM 주소>/v1  OPENAI_COMPATIBLE_MODEL=<모델명>"
echo "     OCR:  OCR_PROVIDER=python  PYTHON_BIN=$PREFIX/ocr/venv/bin/python"
echo "  2) 빌드·기동:  npm run build && npm run start   (또는 pm2/systemd 등록)"
echo "  3) 가드레일 인프라(nginx·감사로그·cron): infra/README.md 참고"
echo "  ※ LLM/모델은 이미 폐쇄망 탑재 전제 — 설치 불필요. 연결만 확인하면 됨."
