# 광고심의 OCR 배포 가이드 (폐쇄망 · Ubuntu 24.04 / Python 3.12 / amd64)

OCR 엔진은 **RapidOCR(한국어 PP-OCRv5)** 하나로 **dev·운영 동일** — 결과가 일치한다. 앱(Node)은 백엔드를 **환경변수로만** 고른다(코드 변경 0). OCR 실패 시 자동으로 모델 단독(graceful)이라 배포가 깨지지 않는다.

| 변수 | 예시 값 | 설명 |
|---|---|---|
| `OCR_PROVIDER` | `python` \| `http` \| `none` | **기본 `python`**(dev·운영 공통 RapidOCR) · 사이드카 `http` · 끄기 `none` |
| `PYTHON_BIN` | `/opt/axp-ocr/venv/bin/python` | (python) OCR용 파이썬 경로 · 기본=`tools/ocr/.venv/bin/python` |
| `OCR_SCRIPT` | (기본=앱 내 `tools/ocr/ocr_rapidocr.py`) | (python) 스크립트 경로 |
| `OCR_URL` | `http://127.0.0.1:8091/ocr` | (http) 사이드카 주소 |

> **로컬/맥 dev**: `bash tools/ocr/setup-dev-venv.sh` 한 번 → `tools/ocr/.venv` 생성 → 기본값으로 바로 동작(운영과 동일 RapidOCR). 인터넷 필요(dev 전용).

## 공통: 한국어 모델 동봉 (~18 MB, 런타임 네트워크 0)
RapidOCR 모델은 처음 사용 시 modelscope에서 받아 `site-packages/rapidocr/models/` 에 캐시된다. 폐쇄망은 **빌드 시 1회 받아 venv/이미지에 포함**한다:
- `korean_PP-OCRv5_rec_mobile.onnx` (13 MB · 인식)
- `ch_PP-OCRv4_det_mobile.onnx` (4.5 MB · 검출)
- `ch_ppocr_mobile_v2.0_cls_mobile.onnx` (0.5 MB · 방향)

## ★ 함정: opencv (headless 서버)
rapidocr가 `opencv-python`(full)을 끌어오면 headless 서버에서 `libGL.so.1` 없음 → `import cv2` 실패(= OCR 동작 불가). **둘 다 제거 후 headless만 설치**:
```bash
pip install -r requirements.txt
pip uninstall -y opencv-python opencv-python-headless || true
pip install opencv-python-headless==4.13.0.92
```

> 모든 빌드는 **ubuntu24.04 + py3.12 + amd64** 환경(또는 그 도커)에서 해야 바이너리 휠이 운영서버와 맞는다.

---
### (a) 휠하우스 — 오프라인 pip
```bash
# [인터넷/사내미러 머신] 휠 + 모델 받기
pip download -r requirements.txt -d wheelhouse/
python -c "from rapidocr import RapidOCR,LangRec,OCRVersion; RapidOCR(params={'Rec.lang_type':LangRec.KOREAN,'Rec.ocr_version':OCRVersion.PPOCRV5})"
cp -r "$(python -c 'import rapidocr,os;print(os.path.dirname(rapidocr.__file__))')/models" models_cache/
# wheelhouse/ + models_cache/ + requirements.txt 반입
# [운영서버]
python3.12 -m venv /opt/axp-ocr/venv
/opt/axp-ocr/venv/bin/pip install --no-index --find-links wheelhouse -r requirements.txt
/opt/axp-ocr/venv/bin/pip uninstall -y opencv-python opencv-python-headless || true
/opt/axp-ocr/venv/bin/pip install --no-index --find-links wheelhouse opencv-python-headless==4.13.0.92
cp -r models_cache/* /opt/axp-ocr/venv/lib/python3.12/site-packages/rapidocr/models/
# 앱 env: OCR_PROVIDER=python  PYTHON_BIN=/opt/axp-ocr/venv/bin/python
```

### (b) venv 통째 반입 — 서버에서 pip 미사용
```bash
# [ubuntu24/amd64 빌드 머신]
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/pip uninstall -y opencv-python opencv-python-headless || true
venv/bin/pip install opencv-python-headless==4.13.0.92
venv/bin/python -c "from rapidocr import RapidOCR,LangRec,OCRVersion; RapidOCR(params={'Rec.lang_type':LangRec.KOREAN,'Rec.ocr_version':OCRVersion.PPOCRV5})"  # 모델까지 venv에 캐시
tar czf axp-ocr-venv.tgz venv
# 반입 후 운영서버: 같은 절대경로로 풀기 권장(venv는 경로 의존). 앱 env: OCR_PROVIDER=python  PYTHON_BIN=<경로>/venv/bin/python
```

### (c) 컨테이너 — 호스트 OS 무관
```bash
# [빌드 머신]  (Dockerfile 동일 폴더 — opencv headless 교체·모델 동봉 포함)
docker build --platform linux/amd64 -t axp-ocr .
docker save axp-ocr | gzip > axp-ocr.tar.gz     # 이미지 반입용
# [운영서버]  docker load < axp-ocr.tar.gz
docker run -d --restart=always -p 127.0.0.1:8091:8091 axp-ocr
# 앱 env: OCR_PROVIDER=http  OCR_URL=http://127.0.0.1:8091/ocr
```

## 검증 (운영서버에서 1회)
```bash
# python 프로바이더
"$PYTHON_BIN" tools/ocr/ocr_rapidocr.py sample.png        # {"lines":[{...}]} 나오면 OK
# http 프로바이더(사이드카)
curl -s --data-binary @sample.png -H "Content-Type: image/png" http://127.0.0.1:8091/ocr
```
