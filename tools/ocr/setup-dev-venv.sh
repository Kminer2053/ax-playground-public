#!/usr/bin/env bash
# 광고심의 OCR(RapidOCR) — 로컬/맥 dev용 venv 셋업. dev·운영이 같은 엔진을 써서 결과가 일치한다.
# (폐쇄망 운영 배포는 README.md 의 a/b/c 참고. 이 스크립트는 인터넷 되는 dev 전용.)
#   사용:  bash tools/ocr/setup-dev-venv.sh    (또는 PYTHON=python3.12 bash ...)
set -euo pipefail
cd "$(dirname "$0")"                        # tools/ocr
PY="${PYTHON:-python3.12}"

echo "[1/3] venv 생성 (.venv ← $PY)"
"$PY" -m venv .venv
.venv/bin/pip install -q --upgrade pip

echo "[2/3] 패키지 설치 + opencv headless 통일"
.venv/bin/pip install -q -r requirements.txt
# rapidocr가 opencv-python(full)을 끌어오므로, 둘 다 제거 후 headless만 깔끔히 남긴다.
.venv/bin/pip uninstall -y -q opencv-python opencv-python-headless >/dev/null 2>&1 || true
.venv/bin/pip install -q opencv-python-headless==4.13.0.92

echo "[3/3] 한국어 모델 사전 캐시(korean PP-OCRv5)"
.venv/bin/python -c "from rapidocr import RapidOCR, LangRec, OCRVersion; RapidOCR(params={'Rec.lang_type': LangRec.KOREAN, 'Rec.ocr_version': OCRVersion.PPOCRV5})" >/dev/null 2>&1

echo "완료 → tools/ocr/.venv  (앱 기본값: OCR_PROVIDER=python, PYTHON_BIN=이 venv)"
