# 광고심의 OCR 사이드카(c) — RapidOCR 한국어, 폐쇄망 오프라인(모델을 이미지에 동봉).
# 빌드(인터넷 또는 사내 미러 필요):  docker build --platform linux/amd64 -t axp-ocr .
# 운영(폐쇄망):  이미지 반입 후  docker run -d -p 8091:8091 axp-ocr
#   → 앱: OCR_PROVIDER=http, OCR_URL=http://<host>:8091/ocr
FROM --platform=linux/amd64 python:3.12-slim

WORKDIR /app
COPY requirements.txt .
# headless 전용: rapidocr가 opencv-python(full)을 끌어오면 제거하고 headless만 남긴다.
# rapidocr가 opencv-python(full)을 끌어오므로, 둘 다 제거 후 headless만 깔끔히 남긴다(libGL 불필요).
RUN pip install --no-cache-dir -r requirements.txt \
 && (pip uninstall -y opencv-python opencv-python-headless 2>/dev/null || true) \
 && pip install --no-cache-dir opencv-python-headless==4.13.0.92

COPY ocr_rapidocr.py ocr_server.py ./

# 한국어 모델을 빌드 시 1회 다운로드해 이미지에 동봉 → 런타임 네트워크 0.
# (빌드도 완전 오프라인이면 이 RUN 대신 사전 다운로드한 모델을
#  /usr/local/lib/python3.12/site-packages/rapidocr/models/ 로 COPY 한다.)
RUN python -c "from rapidocr import RapidOCR, LangRec, OCRVersion; \
RapidOCR(params={'Rec.lang_type': LangRec.KOREAN, 'Rec.ocr_version': OCRVersion.PPOCRV5})"

EXPOSE 8091
CMD ["python", "ocr_server.py"]
